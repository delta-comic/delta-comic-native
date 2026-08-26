import type { CoreDatabase } from '@delta-comic/db'
import { Service } from 'cordis'
import type { Context, Disposable } from 'cordis'
import type { Kysely } from 'kysely'

import { AuditRepository } from './repository'
import type { AppendAuditInput, AuditEntry } from './repository'

/** 能力未声明被硬拒时抛出的结构化错误。 */
export class CapabilityDeniedError extends Error {
  readonly code = 'capability-denied'
  readonly pluginId: string
  readonly capability: string

  constructor(pluginId: string, capability: string) {
    super(`capability denied: ${capability} for ${pluginId}`)
    this.name = 'CapabilityDeniedError'
    this.pluginId = pluginId
    this.capability = capability
  }
}

export interface CapabilityConfig {
  /** 提供宿主数据库时审计日志持久化；缺省仅内存保留最近条目。 */
  readonly db?: Kysely<CoreDatabase>
  /** 内存审计缓冲上限；默认 500。 */
  readonly tailCapacity?: number
}

const DEFAULT_TAIL_CAPACITY = 500

/**
 * 能力门控服务：维护插件 → 能力集映射，对宿主服务调用做结构化校验，
 * 拒绝/调用/错误三类事件写入本地审计日志。
 */
export class CapabilityService extends Service {
  private readonly grants = new Map<string, Set<string>>()
  private readonly repository?: AuditRepository
  private readonly tail: AuditEntry[] = []
  private readonly tailCapacity: number

  constructor(ctx: Context, config: CapabilityConfig = {}) {
    super(ctx, 'capability')
    this.tailCapacity = config.tailCapacity ?? DEFAULT_TAIL_CAPACITY
    if (config.db !== undefined) this.repository = new AuditRepository(config.db)
  }

  /**
   * 声明插件能力集，替换语义以支持插件热重载。
   * 返回的 disposer 随插件 fiber 卸载移除声明。
   */
  grant(pluginId: string, capabilities: readonly string[]): Disposable {
    this.grants.set(pluginId, new Set(capabilities))
    let active = true
    return () => {
      if (!active) return
      active = false
      this.grants.delete(pluginId)
    }
  }

  /** 读取插件当前能力集快照；未声明返回空数组。 */
  capabilitiesOf(pluginId: string): string[] {
    return [...(this.grants.get(pluginId) ?? [])].sort()
  }

  /** 结构化校验：未声明即抛 CapabilityDeniedError 并记录 deny 审计。 */
  assert(pluginId: string, capability: string): void {
    if (this.grants.get(pluginId)?.has(capability) === true) return
    this.record({ kind: 'deny', pluginId, capability })
    throw new CapabilityDeniedError(pluginId, capability)
  }

  /**
   * 门控包装：assert 通过后记录 invoke 审计再执行 run，
   * run 抛错记录 error 审计后原样重抛。
   */
  async guard<T>(
    pluginId: string,
    capability: string,
    action: string,
    run: () => Promise<T>,
  ): Promise<T> {
    this.assert(pluginId, capability)
    this.record({ kind: 'invoke', pluginId, capability, detail: JSON.stringify({ action }) })
    try {
      return await run()
    } catch (cause) {
      this.record({
        kind: 'error',
        pluginId,
        capability,
        detail: JSON.stringify({ action, message: describeCause(cause) }),
      })
      throw cause
    }
  }

  /** 最近审计条目（新→旧），合并内存尾部与持久化仓库。 */
  async recentAudit(limit: number): Promise<AuditEntry[]> {
    if (this.repository === undefined) return this.tail.slice(-limit).reverse()
    const persisted = await this.repository.recent(limit)
    return persisted.length >= limit ? persisted : mergeTail(this.tail, persisted, limit)
  }

  /** 裁剪早于 cutoff 的审计条目（含内存尾部），返回持久化删除数量。 */
  async pruneAuditBefore(cutoff: Date): Promise<number> {
    const cutoffMs = cutoff.getTime()
    for (let i = this.tail.length - 1; i >= 0; i--) {
      const entry = this.tail[i]
      if (entry !== undefined && Date.parse(entry.at) < cutoffMs) this.tail.splice(i, 1)
    }
    if (this.repository === undefined) return 0
    return await this.repository.pruneBefore(cutoff)
  }

  snapshot(): Array<{ pluginId: string; capabilities: string[] }> {
    return [...this.grants.entries()]
      .map(([pluginId, capabilities]) => ({ pluginId, capabilities: [...capabilities].sort() }))
      .sort((a, b) => (a.pluginId < b.pluginId ? -1 : 1))
  }

  private record(input: AppendAuditInput & { detail?: string }): void {
    if (this.repository !== undefined) {
      void this.repository
        .append(input)
        .then(entry => this.pushTail(entry))
        .catch(() => {})
      return
    }
    const ms = Date.now()
    this.seqCounter = (this.seqCounter + 1) % 1_000_000
    this.pushTail({
      id: `${String(ms).padStart(15, '0')}-${this.seqCounter}`,
      at: new Date(ms).toISOString(),
      kind: input.kind,
      pluginId: input.pluginId ?? null,
      capability: input.capability ?? null,
      detail: input.detail ?? null,
    })
  }

  private pushTail(entry: AuditEntry): void {
    this.tail.push(entry)
    if (this.tail.length > this.tailCapacity) {
      this.tail.splice(0, this.tail.length - this.tailCapacity)
    }
    this.ctx.emit('capability/audited', entry)
  }

  private seqCounter = 0
}

declare module 'cordis' {
  interface Context {
    capability: CapabilityService
  }

  interface Events {
    /** 审计条目写入广播（deny/invoke/error）。 @mode emit */
    'capability/audited'(entry: AuditEntry): void
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch {
    return String(cause)
  }
}

function mergeTail(tail: AuditEntry[], persisted: AuditEntry[], limit: number): AuditEntry[] {
  const seenIds = new Set(persisted.map(entry => entry.id))
  const merged = [...persisted]
  for (let i = tail.length - 1; i >= 0 && merged.length < limit; i--) {
    const entry = tail[i]
    if (entry && !seenIds.has(entry.id)) merged.push(entry)
  }
  return merged
}

export type { AuditEntry, AuditKind } from './repository'