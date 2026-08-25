import { DatabaseSync } from 'node:sqlite'

import { Kysely } from 'kysely'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import type {} from '../lib/change'
import { nodeSqliteDialectFrom } from '../lib/driver'
import { bigTextNotNull, bool, defineTable, textNotNull } from '../lib/dsl'
import { applyMigrations } from '../lib/migrator'
import { snapshotOf } from '../lib/snapshot'
import { compileMigration } from '../lib/sql'
import { rowCodec, Store } from '../lib/store'

declare module '../lib/change' {
  interface DatabaseTables {
    comic: ComicRow
  }
}

const comic = defineTable('comic', {
  columns: { id: textNotNull(), title: textNotNull(), snow: bigTextNotNull(), enabled: bool() },
  primaryKey: ['id'],
})

interface ComicRow {
  id: string
  title: string
  snow: bigint
  enabled: boolean | null
}

/** Kysely 行型 = 存储视图；应用行经 codec 还原。 */
interface DataDatabase {
  comic: { id: string; title: string; snow: string; enabled: number | null }
}

const comicCodec = rowCodec<ComicRow>(
  Type.Object({
    id: Type.String(),
    title: Type.String(),
    snow: bigTextNotNull().def.schema,
    enabled: bool().def.schema,
  }),
  { bigint: ['snow'], boolean: ['enabled'] },
)

async function createStore() {
  const sqlite = new DatabaseSync(':memory:')
  const setupDb = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
  const migration = compileMigration(null, snapshotOf([comic]))
  await applyMigrations(setupDb, [
    { pluginId: 'core', n: 1, name: 'base', up: migration.up.join(';\n') + ';', down: '' },
  ])
  await setupDb.destroy()
  return new Store<DataDatabase>(
    new Kysely<DataDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) }),
  )
}

describe('Store 统一事务与 change bus', () => {
  it('commit 后整批发布变更', async () => {
    const store = await createStore()
    const seen: string[] = []
    store.changes.observe('comic', changes => {
      for (const change of changes) seen.push(`${change.kind}:${change.id}`)
    })
    await store.transaction(async scope => {
      await scope.db
        .insertInto('comic')
        .values(comicCodec.toStorage({ id: '1', title: 'a', snow: 123n, enabled: true }))
        .execute()
      scope.record('comic', 'insert', '1')
    })
    expect(seen).toEqual(['insert:1'])
    await store.db.destroy()
  })

  it('事务失败不发布任何事件', async () => {
    const store = await createStore()
    let events = 0
    store.changes.subscribe(() => {
      events += 1
    })
    await expect(
      store.transaction(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(events).toBe(0)
    await store.db.destroy()
  })

  it('行编解码往返并校验', () => {
    const stored = comicCodec.toStorage({ id: '2', title: 'b', snow: 9999999999n, enabled: false })
    expect(stored.snow).toBe('9999999999')
    expect(stored.enabled).toBe(0)
    const restored = comicCodec.fromStorage(stored)
    expect(restored.snow).toBe(9999999999n)
    expect(restored.enabled).toBe(false)
  })

  it('非法雪花字符串抛错', () => {
    expect(() => comicCodec.fromStorage({ id: '3', title: 'c', snow: 'x-not-number' })).toThrow(
      /Cannot convert/,
    )
  })
})