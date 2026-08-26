/**
 * plugin_endpoint 表仓储：EdgeRouter 探测状态持久化。
 *
 * 行形态为 snake_case（TableRow），领域记录为 camelCase EndpointRecord；
 * 时间戳沿用核心表惯例存 ISO 文本。
 */
import type { CoreDatabase, PluginEndpointRow } from '@delta-comic/db'
import { sql, type Kysely } from 'kysely'

/** EdgeRouter 可见的宿主库投影；LoaderDatabase 等超集实例可直接传入。 */
export type EndpointDb = Pick<CoreDatabase, 'plugin_endpoint'>

/** 端点领域记录；lastOkAt 为 epoch 毫秒，null 表示从未成功。 */
export interface EndpointRecord {
  readonly pluginId: string
  readonly url: string
  readonly label: string | null
  readonly latencyMs: number | null
  readonly lastOkAt: number | null
  readonly failCount: number
}

const rowToRecord = (row: PluginEndpointRow): EndpointRecord => ({
  pluginId: row.plugin_id,
  url: row.url,
  label: row.label,
  latencyMs: row.latency_ms,
  lastOkAt: row.last_ok_at === null ? null : Date.parse(row.last_ok_at),
  failCount: row.fail_count,
})

export class EndpointRepository {
  constructor(private readonly db: Kysely<EndpointDb>) {}

  async listByPlugin(pluginId: string): Promise<EndpointRecord[]> {
    const rows = await this.db
      .selectFrom('plugin_endpoint')
      .selectAll()
      .where('plugin_id', '=', pluginId)
      .execute()
    return rows.map(rowToRecord)
  }

  /** 探测成功的落账：latency/last_ok_at 刷新、fail_count 归零。 */
  async recordProbe(
    pluginId: string,
    entry: { url: string; label?: string; latencyMs: number },
    observedAtIso: string,
  ): Promise<void> {
    await this.db
      .insertInto('plugin_endpoint')
      .values({
        plugin_id: pluginId,
        url: entry.url,
        label: entry.label ?? null,
        latency_ms: entry.latencyMs,
        last_ok_at: observedAtIso,
        fail_count: 0,
        updated_at: observedAtIso,
      })
      .onConflict(oc =>
        oc.columns(['plugin_id', 'url']).doUpdateSet({
          // 未携带 label 的探测保留既有展示名；显式 null 清空。
          ...(entry.label === undefined ? {} : { label: entry.label ?? null }),
          latency_ms: entry.latencyMs,
          last_ok_at: observedAtIso,
          fail_count: 0,
          updated_at: observedAtIso,
        }),
      )
      .execute()
  }

  /** 运行期失败的落账：fail_count 原子自增。 */
  async recordFailure(pluginId: string, url: string, failedAtIso: string): Promise<void> {
    await this.db
      .updateTable('plugin_endpoint')
      .set({
        fail_count: sql<number>`plugin_endpoint.fail_count + 1`,
        updated_at: failedAtIso,
      })
      .where(eb => eb.and([eb('plugin_id', '=', pluginId), eb('url', '=', url)]))
      .execute()
  }

  /** report(ok=true) 的触达刷新：仅当行已存在时生效，保留既有 latency。 */
  async touch(pluginId: string, url: string, okAtIso: string): Promise<void> {
    await this.db
      .updateTable('plugin_endpoint')
      .set({ last_ok_at: okAtIso, fail_count: 0, updated_at: okAtIso })
      .where(eb => eb.and([eb('plugin_id', '=', pluginId), eb('url', '=', url)]))
      .execute()
  }

  /** 清理陈旧行：从未成功或 last_ok_at 早于 cutoff 的端点一律移除。 */
  async pruneStale(pluginId: string, cutoffIso: string): Promise<void> {
    await this.db
      .deleteFrom('plugin_endpoint')
      .where(eb =>
        eb.and([
          eb('plugin_id', '=', pluginId),
          eb.or([eb('last_ok_at', 'is', null), eb('last_ok_at', '<', cutoffIso)]),
        ]),
      )
      .execute()
  }

  /** 移除不在保留集合内的行（候选集合收缩后的卫生清理）。 */
  async removeExcept(pluginId: string, keepUrls: readonly string[]): Promise<void> {
    if (keepUrls.length === 0) {
      await this.db.deleteFrom('plugin_endpoint').where('plugin_id', '=', pluginId).execute()
      return
    }
    await this.db
      .deleteFrom('plugin_endpoint')
      .where(eb => eb.and([eb('plugin_id', '=', pluginId), eb('url', 'not in', [...keepUrls])]))
      .execute()
  }
}
