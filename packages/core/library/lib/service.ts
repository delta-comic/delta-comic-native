import { SnowflakeGenerator, type CoreDatabase } from '@delta-comic/db'
/**
 * 用户域服务：打开历史与书架（architecture.md §3.5 / §4 书架）。
 *
 * - 历史以 item_id 主键 upsert，payload_json 存 Item 快照，进度为插件自决 JSON + 归一化 ratio
 * - 书架 kind 为 favorite | later，(kind, item_id) 唯一；变更后经 Events 广播
 */
import { parseItemSnapshot, serializeItemSnapshot, type ItemSnapshot } from '@delta-comic/protocol'
import { Service, type Context } from 'cordis'
import type { Kysely } from 'kysely'

import {
  HistoryRepository,
  ShelfRepository,
  type HistoryRecord,
  type ShelfKind,
  type ShelfRecord,
} from './repository'

export interface HistoryServiceOptions {
  /** 时钟注入点，测试用。 */
  readonly now?: () => number
}

const SNOWFLAKE_EPOCH_MS = 1_767_225_600_000

/** 打开历史条目：item 为解析后的 Item 快照，payload 损坏时缺省并回退展示字段。 */
export interface HistoryEntry {
  readonly itemId: string
  readonly title: string
  readonly playerKey: string
  readonly item?: ItemSnapshot
  readonly progressJson?: string
  readonly progressRatio?: number
  readonly openedCount: number
  readonly firstOpenedAt: string
  readonly lastOpenedAt: string
}

export interface ProgressPatch {
  /** 插件自决进度的 JSON 序列化；提供空串视为清除。 */
  readonly json?: string
  /** 归一化进度 0~1。 */
  readonly ratio?: number
}

export class HistoryService extends Service {
  private readonly repo: HistoryRepository
  private readonly now: () => number

  constructor(ctx: Context, db: Kysely<CoreDatabase>, options: HistoryServiceOptions = {}) {
    super(ctx, 'history')
    this.repo = new HistoryRepository(db)
    this.now = options.now ?? Date.now
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString()
  }

  private toEntry(record: HistoryRecord): HistoryEntry {
    const { payloadJson, progressJson, progressRatio, ...rest } = record
    const item = parseItemSnapshot(payloadJson)
    const parsedProgress = progressJson === null ? {} : { progressJson }
    const parsedRatio = progressRatio === null ? {} : { progressRatio }
    return { ...rest, ...(item === undefined ? {} : { item }), ...parsedProgress, ...parsedRatio }
  }

  /** 记录一次打开：新条目计数 1，重复打开计数 +1 并刷新快照展示字段。 */
  async recordOpen(item: ItemSnapshot): Promise<void> {
    if (item.id.trim().length === 0) throw new TypeError('Item id 不能为空')
    const nowIso = this.nowIso()
    const existing = await this.repo.get(item.id)
    await this.repo.upsert({
      itemId: item.id,
      title: item.title,
      playerKey: item.playerKey,
      payloadJson: serializeItemSnapshot(item),
      progressJson: existing?.progressJson ?? null,
      progressRatio: existing?.progressRatio ?? null,
      openedCount: (existing?.openedCount ?? 0) + 1,
      firstOpenedAt: existing?.firstOpenedAt ?? nowIso,
      lastOpenedAt: nowIso,
    })
    this.ctx.emit('library/history-changed')
  }

  /** 更新进度；历史不存在抛错，ratio 越界 [0,1] 抛错。 */
  async updateProgress(itemId: string, patch: ProgressPatch): Promise<void> {
    if (patch.json === undefined && patch.ratio === undefined) {
      throw new TypeError('进度更新内容为空')
    }
    if (patch.ratio !== undefined && !(patch.ratio >= 0 && patch.ratio <= 1)) {
      throw new TypeError(`归一化进度越界：${patch.ratio}`)
    }
    const existing = await this.repo.get(itemId)
    if (existing === undefined) throw new Error(`历史记录不存在：${itemId}`)
    await this.repo.updateProgress(itemId, {
      progressJson: patch.json ?? null,
      progressRatio: patch.ratio ?? null,
    })
    this.ctx.emit('library/history-changed')
  }

  /** 最近打开历史，last_opened_at 倒序；limit 提供时截断且须为正整数。 */
  async list(options: { readonly limit?: number } = {}): Promise<readonly HistoryEntry[]> {
    const limit = options.limit
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new TypeError(`limit 须为正整数：${limit}`)
    }
    const records = await this.repo.list(limit)
    return records.map(record => this.toEntry(record))
  }

  async get(itemId: string): Promise<HistoryEntry | undefined> {
    const record = await this.repo.get(itemId)
    return record === undefined ? undefined : this.toEntry(record)
  }

  async remove(itemId: string): Promise<void> {
    await this.repo.remove(itemId)
    this.ctx.emit('library/history-changed')
  }

  async clear(): Promise<void> {
    await this.repo.clear()
    this.ctx.emit('library/history-changed')
  }
}

export interface ShelfServiceOptions {
  /** 时钟注入点，测试用。 */
  readonly now?: () => number
}

/** 书架条目：item 为解析后的 Item 快照，payload 损坏时缺省并回退展示字段。 */
export interface ShelfEntry {
  readonly id: string
  readonly kind: ShelfKind
  readonly itemId: string
  readonly title: string
  readonly playerKey: string
  readonly item?: ItemSnapshot
  readonly createdAt: string
  readonly updatedAt: string
}

export class ShelfService extends Service {
  private readonly repo: ShelfRepository
  private readonly snowflake = new SnowflakeGenerator({ epochMs: SNOWFLAKE_EPOCH_MS })
  private readonly now: () => number

  constructor(ctx: Context, db: Kysely<CoreDatabase>, options: ShelfServiceOptions = {}) {
    super(ctx, 'shelf')
    this.repo = new ShelfRepository(db)
    this.now = options.now ?? Date.now
  }

  private toEntry(record: ShelfRecord): ShelfEntry {
    const { payloadJson, ...rest } = record
    const item = parseItemSnapshot(payloadJson)
    return { ...rest, ...(item === undefined ? {} : { item }) }
  }

  /** 收入书架；(kind, item_id) 已存在时抛错。 */
  async add(kind: ShelfKind, item: ItemSnapshot): Promise<ShelfEntry> {
    if (item.id.trim().length === 0) throw new TypeError('Item id 不能为空')
    const existing = await this.repo.findByTarget(kind, item.id)
    if (existing !== undefined) throw new Error(`书架条目已存在：${kind}/${item.id}`)
    const nowIso = new Date(this.now()).toISOString()
    const created: ShelfRecord = {
      id: this.snowflake.next(),
      kind,
      itemId: item.id,
      title: item.title,
      playerKey: item.playerKey,
      payloadJson: serializeItemSnapshot(item),
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    await this.repo.insert(created)
    this.ctx.emit('library/shelf-changed')
    return this.toEntry(created)
  }

  /** 移出书架；目标缺失抛错。 */
  async remove(kind: ShelfKind, itemId: string): Promise<void> {
    const existing = await this.repo.findByTarget(kind, itemId)
    if (existing === undefined) throw new Error(`书架条目不存在：${kind}/${itemId}`)
    await this.repo.remove(existing.id)
    this.ctx.emit('library/shelf-changed')
  }

  /** 是否已在书架对应分区。 */
  async has(kind: ShelfKind, itemId: string): Promise<boolean> {
    return (await this.repo.findByTarget(kind, itemId)) !== undefined
  }

  /** 书架条目，created_at 倒序；kind 提供时过滤分区。 */
  async list(kind?: ShelfKind): Promise<readonly ShelfEntry[]> {
    const records = await this.repo.list(kind)
    return records.map(record => this.toEntry(record))
  }
}

declare module 'cordis' {
  interface Context {
    history: HistoryService
    shelf: ShelfService
  }

  interface Events {
    /** 打开历史集合或进度变更广播。 @mode emit */
    'library/history-changed'(): void

    /** 书架条目变更广播。 @mode emit */
    'library/shelf-changed'(): void
  }
}