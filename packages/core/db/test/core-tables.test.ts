import { DatabaseSync } from 'node:sqlite'

import { Kysely, sql } from 'kysely'
import { describe, expect, it } from 'vitest'

import {
  coreMigrations,
  downloadTaskTable,
  itemHistoryTable,
  pluginStateTable,
  resourceTable,
  shelfItemTable,
  subscriptionGroupTable,
  subscriptionTable,
  type CoreDatabase,
} from '../lib/core-tables'
import { nodeSqliteDialectFrom } from '../lib/driver'
import { applyMigrations, readLedger } from '../lib/migrator'

describe('core tables', () => {
  it('coreMigrations 建表并可读写三表', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const db = new Kysely<CoreDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })
    const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })

    const applied = await applyMigrations(ledger, [...coreMigrations])
    expect(applied).toHaveLength(3)
    expect(applied[0]).toMatchObject({ pluginId: 'core', n: 1 })
    expect(applied[1]).toMatchObject({ pluginId: 'core', n: 2, name: 'core-resource-v1' })
    expect(applied[2]).toMatchObject({ pluginId: 'core', n: 3, name: 'core-user-v1' })
    // v1 基座冻结：不涉及资源域两表。
    expect(coreMigrations[0]?.up).not.toContain('resource')
    expect(coreMigrations[0]?.up).not.toContain('download_task')
    // v2 冻结在资源域：不涉及用户域四表。
    expect(coreMigrations[1]?.up).not.toContain('subscription_group')
    expect(coreMigrations[1]?.up).not.toContain('item_history')

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

    await db
      .insertInto(resourceTable.name)
      .values({
        kind: 'image',
        ref: 'https://example.test/a.jpg',
        size_bytes: 1024,
        checksum_algorithm: 'sha256',
        checksum_digest: 'aa',
        mime: 'image/jpeg',
        updated_at: '2026-08-25T00:00:00.000Z',
      })
      .execute()
    const resources = await db.selectFrom(resourceTable.name).selectAll().execute()
    expect(resources).toHaveLength(1)

    await db
      .insertInto(downloadTaskTable.name)
      .values({
        id: 'task-1',
        kind: 'image',
        ref: 'https://example.test/a.jpg',
        dest_key: 'downloads/a.jpg',
        status: 'queued',
        received_bytes: 0,
        total_bytes: 1024,
        error: null,
        created_at: '2026-08-25T00:00:00.000Z',
        updated_at: '2026-08-25T00:00:00.000Z',
      })
      .execute()
    const tasks = await db.selectFrom(downloadTaskTable.name).selectAll().execute()
    expect(tasks).toHaveLength(1)

    const now = '2026-08-26T00:00:00.000Z'
    await db.insertInto(subscriptionGroupTable.name).values({
      id: 'default',
      title: '默认分组',
      sort_key: 0,
      created_at: now,
      updated_at: now,
    }).execute()
    await db.insertInto(subscriptionTable.name).values({
      id: 'sub-1',
      target_kind: 'creator',
      target_id: 'c-1',
      group_id: 'default',
      sort_key: 1,
      created_at: now,
      updated_at: now,
    }).execute()
    await db.insertInto(itemHistoryTable.name).values({
      item_id: 'item-1',
      title: '第 1 话',
      player_key: 'sample/player',
      payload_json: '{"id":"item-1"}',
      progress_json: null,
      progress_ratio: null,
      opened_count: 1,
      first_opened_at: now,
      last_opened_at: now,
    }).execute()
    await db.insertInto(shelfItemTable.name).values({
      id: 'shelf-1',
      kind: 'favorite',
      item_id: 'item-1',
      title: '第 1 话',
      player_key: 'sample/player',
      payload_json: '{"id":"item-1"}',
      created_at: now,
      updated_at: now,
    }).execute()
    const groups = await db.selectFrom(subscriptionGroupTable.name).selectAll().execute()
    expect(groups).toHaveLength(1)
    const history = await db.selectFrom(itemHistoryTable.name).selectAll().execute()
    expect(history[0]?.progress_ratio).toBeNull()
    const shelf = await db.selectFrom(shelfItemTable.name).selectAll().execute()
    expect(shelf).toHaveLength(1)

    await sql`DROP TABLE ${sql.table('plugin_state')}`.execute(db)
    await db.destroy()
    await ledger.destroy()
  })

  it('coreMigrations 的 down 可回滚资源域两表并保留基线', async () => {
    const sqlite = new DatabaseSync(':memory:')
    const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
    await applyMigrations(ledger, [...coreMigrations])
    const { rollbackMigrations } = await import('../lib/migrator')
    const undone = await rollbackMigrations(ledger, [...coreMigrations])
    expect(undone).toEqual([
      { pluginId: 'core', n: 3, name: 'core-user-v1' },
      { pluginId: 'core', n: 2, name: 'core-resource-v1' },
      { pluginId: 'core', n: 1, name: 'core-tables-v1' },
    ])
    expect(await readLedger(ledger)).toEqual([])
    // v3 的 down 删除用户域四表；v2 的 down 删除资源域两表；v1 基线的 down 为空：清账并保留基础表结构。
    const { rows } = await sql<{
      name: string
    }>`SELECT name FROM sqlite_master WHERE type = 'table'`.execute(ledger)
    const names = rows.map(row => row.name)
    expect(names).toContain('plugin_state')
    expect(names).not.toContain('resource')
    expect(names).not.toContain('download_task')
    expect(names).not.toContain('subscription_group')
    expect(names).not.toContain('subscription')
    expect(names).not.toContain('item_history')
    expect(names).not.toContain('shelf_item')
    await ledger.destroy()
  })
})