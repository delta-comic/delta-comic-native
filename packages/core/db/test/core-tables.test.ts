import { DatabaseSync } from 'node:sqlite'

import { Kysely, sql } from 'kysely'
import { describe, expect, it } from 'vitest'

import { coreMigrations, pluginStateTable, type CoreDatabase } from '../lib/core-tables'
import { nodeSqliteDialectFrom } from '../lib/driver'
import { applyMigrations, readLedger } from '../lib/migrator'

describe('core tables', () => {
  it('coreMigrations 建表并可读写 plugin_state', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new Kysely<CoreDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })
    const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })

    const applied = await applyMigrations(ledger, [...coreMigrations])
    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ pluginId: 'core', n: 1 })

    const row = {
      plugin_id: 'sample',
      state: 'disabled',
      version: '1.0.0',
      error: JSON.stringify({ stage: 'verify', message: '签名不符' }),
      updated_at: '2026-08-25T00:00:00.000Z',
    }
    await db.insertInto(pluginStateTable.name).values(row).execute()
    const rows = await db.selectFrom(pluginStateTable.name).selectAll().execute()
    expect(rows).toEqual([row])

    await sql`DROP TABLE ${sql.table('plugin_state')}`.execute(db)
    await db.destroy()
    await ledger.destroy()
  })

  it('coreMigrations 的 down 可回滚', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
    await applyMigrations(ledger, [...coreMigrations])
    const { rollbackMigrations } = await import('../lib/migrator')
    const undone = await rollbackMigrations(ledger, [...coreMigrations])
    expect(undone).toEqual([{ pluginId: 'core', n: 1, name: 'core-tables-v1' }])
    expect(await readLedger(ledger)).toEqual([])
    // 基线 migration 的 down 为空：清账但保留基础表结构。
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plugin_state'")
      .all()
    expect(tables).toHaveLength(1)
    await ledger.destroy()
  })
})
