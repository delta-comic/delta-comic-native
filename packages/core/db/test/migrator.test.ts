import { DatabaseSync } from 'node:sqlite'

import { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'

import { nodeSqliteDialectFrom } from '../lib/driver'
import { defineTable, text, textNotNull } from '../lib/dsl'
import {
  applyMigrations,
  assertUniqueMigrations,
  readLedger,
  rollbackMigrations,
  sortMigrations,
  topoSortIds,
  type MigrationEntry,
} from '../lib/migrator'
import { snapshotOf } from '../lib/snapshot'
import { compileMigration } from '../lib/sql'

const comicV1 = [
  defineTable('comic', {
    columns: { id: textNotNull(), title: textNotNull(), author: text() },
    primaryKey: ['id'],
    indexes: [{ columns: ['title'] }],
  }),
]

interface ComicRow {
  id: string
  title: string
  author: string | null
}

interface DataDatabase {
  comic: ComicRow
}

function entry(up: string, n = 1, pluginId = 'core'): MigrationEntry {
  return { pluginId, n, name: `n${n}`, up, down: '' }
}

describe('node:sqlite driver 与迁移往返', () => {
  it('编译产物建表、插入并回查', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const ledgerDb = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
    const dataDb = new Kysely<DataDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })

    const migration = compileMigration(null, snapshotOf(comicV1))
    const applied = await applyMigrations(ledgerDb, [entry(migration.up.join(';\n') + ';')])
    expect(applied).toHaveLength(1)

    await dataDb.insertInto('comic').values({ id: '1001', title: '示例', author: null }).execute()
    const rows = await dataDb.selectFrom('comic').selectAll().execute()
    expect(rows).toEqual([{ id: '1001', title: '示例', author: null }])
    await ledgerDb.destroy()
    await dataDb.destroy()
  })

  it('ledger 幂等：重复调用不再应用', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
    const migration = compileMigration(null, snapshotOf(comicV1))
    expect(await applyMigrations(db, [entry(migration.up.join(';\n') + ';')])).toHaveLength(1)
    expect(await applyMigrations(db, [entry(migration.up.join(';\n') + ';')])).toEqual([])
    await db.destroy()
  })
})

describe('migration registry', () => {
  it('(pluginId, n) 冲突抛错', () => {
    expect(() => assertUniqueMigrations([entry('', 1), entry('', 1)])).toThrow('序号冲突')
  })

  it('按插件依赖拓扑与序号排序', () => {
    const entries = [
      entry('c2', 2, 'core'),
      entry('p1', 1, 'plugin-a'),
      entry('p10', 10, 'plugin-b'),
    ]
    const order = sortMigrations(entries, { 'plugin-a': ['plugin-b'] })
    expect(order.map(item => `${item.pluginId}:${item.n}`)).toEqual([
      'core:2',
      'plugin-b:10',
      'plugin-a:1',
    ])
  })

  it('依赖环抛错', () => {
    const entries = [entry('', 1, 'a'), entry('', 1, 'b')]
    expect(() => sortMigrations(entries, { a: ['b'], b: ['a'] })).toThrow('环')
  })

  it('未知依赖抛错', () => {
    const entries = [entry('', 1, 'a')]
    expect(() => sortMigrations(entries, { a: ['ghost'] })).toThrow('未知')
  })

  it('topoSortIds 保持无依赖时字典序稳定', () => {
    expect(topoSortIds(['c', 'a', 'b'])).toEqual(['a', 'b', 'c'])
    expect(
      topoSortIds(['b', 'a'], {
        a: ['b'],
      }),
    ).toEqual(['b', 'a'])
  })
})

describe('ledger 读取与 down 回滚', () => {
  it('readLedger 返回已应用记录', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
    await applyMigrations(db, [entry('SELECT 1;', 1, 'a'), entry('SELECT 2;', 2, 'a')])
    expect(await readLedger(db)).toEqual([
      { pluginId: 'a', n: 1, name: 'n1' },
      { pluginId: 'a', n: 2, name: 'n2' },
    ])
    await db.destroy()
  })

  it('rollbackMigrations 逆序执行 down 并清 ledger', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })

    const entries: MigrationEntry[] = [
      {
        pluginId: 'p',
        n: 1,
        name: 'create',
        up: 'CREATE TABLE t (id TEXT NOT NULL PRIMARY KEY);',
        down: 'DROP TABLE t;',
      },
      {
        pluginId: 'p',
        n: 2,
        name: 'add-column',
        up: "INSERT INTO t VALUES ('keep');",
        down: 'SELECT 1;',
      },
    ]
    await applyMigrations(db, entries)
    expect(await readLedger(db)).toHaveLength(2)

    const undone = await rollbackMigrations(db, entries)
    expect(undone).toEqual([
      { pluginId: 'p', n: 2, name: 'add-column' },
      { pluginId: 'p', n: 1, name: 'create' },
    ])
    expect(await readLedger(db)).toEqual([])
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't'")
      .all()
    expect(tables).toEqual([])
    await db.destroy()
  })

  it('rollbackMigrations 跳过未落账条目', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
    const entries = [entry('u1', 1, 'p')]
    expect(await rollbackMigrations(db, entries)).toEqual([])
    await db.destroy()
  })
})