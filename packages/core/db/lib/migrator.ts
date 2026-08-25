/**
 * Plugin Migration Registry。
 *
 * - 收集核心与插件 migration；校验 (pluginId, n) 唯一
 * - 插件间按依赖拓扑排序，插件内按序号升序
 * - 统一 ledger 表记录应用状态，支持动态插件增量迁移
 */
import { sql, type Kysely } from 'kysely'

export interface MigrationEntry {
  /** 唯一 ID：核心为 'core'，插件为 manifest id。 */
  readonly pluginId: string
  /** 文件名开头数字序号。 */
  readonly n: number
  readonly name: string
  readonly up: string
  readonly down: string
}

export interface AppliedMigration {
  readonly pluginId: string
  readonly n: number
  readonly name: string
}

export const MIGRATION_LEDGER_TABLE = 'migration_ledger'

/** 校验 (pluginId, n) 唯一性，冲突抛错。 */
export function assertUniqueMigrations(entries: readonly MigrationEntry[]): void {
  const seen = new Set<string>()
  for (const entry of entries) {
    const key = `${entry.pluginId}/${entry.n}`
    if (seen.has(key)) throw new Error(`migration 序号冲突：${key}`)
    seen.add(key)
  }
}

/** 插件依赖拓扑排序（Kahn）；环或未知依赖抛错。 */
export function sortMigrations(
  entries: readonly MigrationEntry[],
  pluginDeps: Readonly<Record<string, readonly string[]>> = {},
): AppliedMigration[] {
  const ids = new Set(entries.map(entry => entry.pluginId))
  const indegree = new Map<string, number>()
  const dependents = new Map<string, Set<string>>()
  for (const id of ids) {
    indegree.set(id, 0)
    dependents.set(id, new Set())
  }
  for (const [id, deps] of Object.entries(pluginDeps)) {
    if (!ids.has(id)) continue
    for (const dep of deps) {
      if (!ids.has(dep)) throw new Error(`未知 migration 依赖：${id} -> ${dep}`)
      indegree.set(id, (indegree.get(id) ?? 0) + 1)
      dependents.get(dep)?.add(id)
    }
  }

  let queue = [...ids].filter(id => (indegree.get(id) ?? 0) === 0).sort(compareId)
  const ordered: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    ordered.push(id)
    for (const next of dependents.get(id) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1
      indegree.set(next, left)
      if (left === 0) insertSorted(queue, next)
    }
  }
  if (ordered.length !== ids.size) {
    const stuck = [...ids].filter(id => !ordered.includes(id))
    throw new Error(`migration 依赖存在环：${stuck.sort().join(', ')}`)
  }
  const rank = new Map(ordered.map((id, index) => [id, index]))
  return [...entries]
    .sort((a, b) => (rank.get(a.pluginId) ?? 0) - (rank.get(b.pluginId) ?? 0) || a.n - b.n)
    .map(({ pluginId, n, name }) => ({ pluginId, n, name }))
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function insertSorted(queue: string[], id: string): void {
  queue.push(id)
  queue.sort(compareId)
}

interface LedgerRow {
  plugin_id: string
  n: number
  name: string
  applied_at: string
}

export interface MigrationLedgerDatabase {
  [MIGRATION_LEDGER_TABLE]: LedgerRow
}

export type AnyKysely = Kysely<MigrationLedgerDatabase>

async function ensureLedger(db: AnyKysely): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS ${sql.table(MIGRATION_LEDGER_TABLE)} (
      "plugin_id" TEXT NOT NULL,
      "n" INTEGER NOT NULL,
      "name" TEXT NOT NULL,
      "applied_at" TEXT NOT NULL,
      PRIMARY KEY ("plugin_id", "n")
    )
  `.execute(db)
}

/**
 * 按拓扑+序号顺序应用未落账的 migration；
 * 每条在独立事务内执行并写 ledger，重复调用幂等。
 */
export async function applyMigrations(
  db: AnyKysely,
  entries: readonly MigrationEntry[],
  pluginDeps: Readonly<Record<string, readonly string[]>> = {},
): Promise<AppliedMigration[]> {
  assertUniqueMigrations(entries)
  await ensureLedger(db)
  const applied = await db.selectFrom(MIGRATION_LEDGER_TABLE).select(['plugin_id', 'n']).execute()
  const doneKeys = new Set(applied.map(row => `${row.plugin_id}/${row.n}`))
  const order = sortMigrations(entries, pluginDeps)
  const pending = entries.filter(entry => {
    if (doneKeys.has(`${entry.pluginId}/${entry.n}`)) return false
    return order.some(item => item.pluginId === entry.pluginId && item.n === entry.n)
  })

  for (const entry of pending) {
    await db.transaction().execute(async trx => {
      await sql.raw(entry.up).execute(trx)
      await trx
        .insertInto(MIGRATION_LEDGER_TABLE)
        .values({
          plugin_id: entry.pluginId,
          n: entry.n,
          name: entry.name,
          applied_at: new Date().toISOString(),
        })
        .execute()
    })
  }
  return pending.map(({ pluginId, n, name }) => ({ pluginId, n, name }))
}