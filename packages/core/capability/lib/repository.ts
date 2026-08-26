import type { AuditLogRow, CoreDatabase } from '@delta-comic/db'
import { sql } from 'kysely'
import type { Kysely } from 'kysely'

/** 审计条目类别：deny 能力被拒 / invoke 已放行调用 / error 放行后执行出错。 */
export type AuditKind = 'deny' | 'invoke' | 'error'

export interface AuditEntry {
  readonly id: string
  readonly at: string
  readonly kind: AuditKind
  readonly pluginId: string | null
  readonly capability: string | null
  readonly detail: string | null
}

export interface AppendAuditInput {
  readonly kind: AuditKind
  readonly pluginId?: string
  readonly capability?: string
  /** JSON 序列化后的补充信息；由调用方负责序列化。 */
  readonly detail?: string
}

type AuditDb = Pick<CoreDatabase, 'audit_log'>

function toEntry(row: AuditLogRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    kind: row.kind as AuditKind,
    pluginId: row.plugin_id,
    capability: row.capability,
    detail: row.detail,
  }
}

/** 审计日志仓库：追加、倒序分页读取与按时间裁剪。 */
export class AuditRepository {
  private readonly db: Kysely<AuditDb>
  private seq = 0

  constructor(db: Kysely<AuditDb>) {
    this.db = db
  }

  async append(input: AppendAuditInput, at = new Date()): Promise<AuditEntry> {
    const ms = at.getTime()
    this.seq = (this.seq + 1) % 1_000_000
    const entry: AuditEntry = {
      id: `${String(ms).padStart(15, '0')}-${this.seq}`,
      at: at.toISOString(),
      kind: input.kind,
      pluginId: input.pluginId ?? null,
      capability: input.capability ?? null,
      detail: input.detail ?? null,
    }
    await this.db
      .insertInto('audit_log')
      .values({
        id: entry.id,
        at: entry.at,
        kind: entry.kind,
        plugin_id: entry.pluginId,
        capability: entry.capability,
        detail: entry.detail,
      })
      .execute()
    return entry
  }

  /** 最近 limit 条，按写入顺序倒序（新→旧）。 */
  async recent(limit: number): Promise<AuditEntry[]> {
    const rows = await this.db
      .selectFrom('audit_log')
      .selectAll()
      .orderBy(sql`at desc`)
      .orderBy(sql`id desc`)
      .limit(limit)
      .execute()
    return rows.map(toEntry)
  }

  /** 删除 at 早于 cutoff 的条目，返回删除数量。 */
  async pruneBefore(cutoff: Date): Promise<number> {
    const result = await this.db
      .deleteFrom('audit_log')
      .where('at', '<', cutoff.toISOString())
      .executeTakeFirst()
    return Number(result.numDeletedRows)
  }
}