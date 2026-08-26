/**
 * FeedSession：单个 surface 的聚合会话（architecture.md §4）。
 *
 * - 每 provider 独立 cursor/loading/hasMore/error/lastLoadedAt
 * - surface 层合并去重（itemId 冲突保留当前 seed 下分值更高者）、
 *   seed 排序、分批追加
 * - 部分 provider 失败仅剔除该 provider 待显式 retry，全部失败才进入整体 error
 * - 快照式对外：subscribe/getSnapshot 可直连 useSyncExternalStore
 */
import type { FeedSurfaceDescriptor, Item } from '@delta-comic/protocol'

import { compareRank, itemRank, newSessionSeed, type SessionSeed } from './seed'

export type FeedProviderStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface FeedProviderSnapshot {
  readonly key: string
  readonly status: FeedProviderStatus
  readonly hasMore: boolean
  readonly error?: string
  readonly lastLoadedAt?: number
}

export interface FeedEntry {
  readonly item: Item
  readonly providerKey: string
  readonly rank: number
}

/** idle 未发起过加载 / loading 进行中 / error 最近一轮全部失败 / ready 正常流转。 */
export type FeedPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface FeedSnapshot {
  readonly seed: SessionSeed
  readonly entries: readonly FeedEntry[]
  readonly providers: readonly FeedProviderSnapshot[]
  readonly phase: FeedPhase
  /** 最近一轮存在失败但仍有 provider 成功产出。 */
  readonly lastRoundPartialFailure: boolean
}

export interface FeedSessionOptions {
  /** 固定 seed（测试/复现场景）；缺省即时生成。 */
  readonly seed?: SessionSeed
  /** refresh 时的 seed 工厂；缺省 newSessionSeed。 */
  readonly newSeed?: () => SessionSeed
}

interface ProviderSlot {
  readonly provider: FeedSurfaceDescriptor['providers'][number]
  cursor?: string
  hasMore: boolean
  status: FeedProviderStatus
  error?: string
  lastLoadedAt?: number
}

function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  return String(reason)
}

export class FeedSession {
  private readonly slots = new Map<string, ProviderSlot>()
  private readonly entriesById = new Map<string, FeedEntry>()
  private readonly listeners = new Set<() => void>()
  private readonly seedFactory: () => SessionSeed
  private seedValue: SessionSeed
  private cached!: FeedSnapshot
  private inflight?: Promise<void>
  private roundCount = 0
  private lastRoundAllFailed = false
  private lastRoundPartialFailure = false

  constructor(descriptor: FeedSurfaceDescriptor, options: FeedSessionOptions = {}) {
    for (const provider of descriptor.providers) {
      if (this.slots.has(provider.key)) {
        throw new Error(`FeedSurface ${descriptor.id} 内 provider key 重复：${provider.key}`)
      }
      this.slots.set(provider.key, { provider, hasMore: true, status: 'idle' })
    }
    this.seedValue = options.seed ?? newSessionSeed()
    this.seedFactory = options.newSeed ?? (() => newSessionSeed())
    this.rebuild()
  }

  get seed(): SessionSeed {
    return this.seedValue
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): FeedSnapshot {
    return this.cached
  }

  /** 并发拉取所有可继续的分页源；进行中时复用同一 promise。 */
  loadMore(): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    const round = this.runRound(slot => slot.status === 'idle' || slot.status === 'ready')
    this.inflight = round.then(
      () => {
        this.inflight = undefined
      },
      error => {
        this.inflight = undefined
        throw error
      },
    )
    return this.inflight
  }

  /** 单独重试某个失败 provider；其余 provider 状态不受影响。 */
  async retry(providerKey: string): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    const slot = this.slots.get(providerKey)
    if (slot === undefined) throw new Error(`provider 不存在：${providerKey}`)
    await this.runRound(target => target === slot)
  }

  /** 换 seed 并清空已聚合内容后立即拉取一轮。 */
  async refresh(): Promise<void> {
    if (this.inflight !== undefined) return this.inflight
    this.seedValue = this.seedFactory()
    this.entriesById.clear()
    for (const slot of this.slots.values()) {
      slot.cursor = undefined
      slot.hasMore = true
      slot.status = 'idle'
      slot.error = undefined
      slot.lastLoadedAt = undefined
    }
    this.rebuild()
    await this.loadMore()
  }

  private runRound(select: (slot: ProviderSlot) => boolean): Promise<void> {
    const targets = [...this.slots.values()].filter(
      slot => select(slot) && slot.hasMore && slot.status !== 'loading',
    )
    this.roundCount += 1
    if (targets.length === 0) {
      this.lastRoundAllFailed = false
      this.lastRoundPartialFailure = false
      this.rebuild()
      return Promise.resolve()
    }
    for (const slot of targets) slot.status = 'loading'
    this.rebuild()
    return Promise.allSettled(targets.map(slot => slot.provider.fetch(slot.cursor))).then(
      results => {
        let succeeded = 0
        results.forEach((result, index) => {
          const slot = targets[index]
          if (result.status === 'fulfilled') {
            const page = result.value
            slot.cursor = page.cursor
            slot.hasMore = page.hasMore
            slot.status = 'ready'
            slot.error = undefined
            slot.lastLoadedAt = Date.now()
            this.mergePage(page.items, slot)
            succeeded += 1
          } else {
            slot.status = 'error'
            slot.error = describeError(result.reason)
          }
        })
        this.lastRoundAllFailed = succeeded === 0
        this.lastRoundPartialFailure = succeeded > 0 && succeeded < targets.length
        this.rebuild()
      },
    )
  }

  private mergePage(items: readonly Item[], slot: ProviderSlot): void {
    for (const item of items) {
      const rank = itemRank(this.seedValue, slot.provider.key, item.id)
      const existing = this.entriesById.get(item.id)
      if (existing === undefined || rank > existing.rank) {
        this.entriesById.set(item.id, { item, providerKey: slot.provider.key, rank })
      }
    }
  }

  private rebuild(): void {
    const entries = [...this.entriesById.values()].sort((a, b) =>
      compareRank(
        { providerKey: a.providerKey, itemId: a.item.id, rank: a.rank },
        { providerKey: b.providerKey, itemId: b.item.id, rank: b.rank },
      ),
    )
    const providers = [...this.slots.values()].map((slot): FeedProviderSnapshot => ({
      key: slot.provider.key,
      status: slot.status,
      hasMore: slot.hasMore,
      ...(slot.error === undefined ? {} : { error: slot.error }),
      ...(slot.lastLoadedAt === undefined ? {} : { lastLoadedAt: slot.lastLoadedAt }),
    }))
    const anyLoading = [...this.slots.values()].some(slot => slot.status === 'loading')
    const phase: FeedPhase =
      this.roundCount === 0
        ? 'idle'
        : anyLoading
          ? 'loading'
          : this.lastRoundAllFailed
            ? 'error'
            : 'ready'
    const previous = this.cached as FeedSnapshot | undefined
    this.cached = {
      seed: this.seedValue,
      entries,
      providers,
      phase,
      lastRoundPartialFailure: this.lastRoundPartialFailure,
    }
    // 首次构建无监听者，后续仅在快照实际替换时分发
    if (previous !== undefined) {
      for (const listener of this.listeners) listener()
    }
  }
}