import { DatabaseSync } from 'node:sqlite'

import { applyMigrations, coreMigrations, type CoreDatabase } from '@delta-comic/db'
import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import { Context } from 'cordis'
import { Kysely } from 'kysely'

export interface TestDb {
  db: Kysely<CoreDatabase>
  destroy(): Promise<void>
}

/** 内存库并应用核心迁移，供 repository 测试使用。 */
export async function createTestDb(): Promise<TestDb> {
  const sqlite = new DatabaseSync(':memory:')
  const db = new Kysely<CoreDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })
  const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
  await applyMigrations(ledger, [...coreMigrations])
  return {
    db,
    destroy: async () => {
      await db.destroy()
      await ledger.destroy()
    },
  }
}

/** 独立 cordis 上下文，避免测试间服务状态串扰。 */
export function createContext(): Context {
  return new Context()
}