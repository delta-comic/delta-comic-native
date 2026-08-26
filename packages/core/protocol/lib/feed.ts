/**
 * Feed / Card 协议（architecture.md §4）。
 *
 * - Feed 两级结构：SecondaryTab -> FeedSurface -> FeedProvider[] -> Item[] -> Waterfall -> Card
 * - provider 独立 cursor/hasMore；surface 层负责合并去重排序分页与部分失败重试
 * - Item 为 Feed/Search/Subscribe 内容流统一形态，playerKey 关联 PlayerInputRegistry
 * - 菜单经 ItemActionProvider 注册，顺序 = 返回顺序，icon 视觉归 Card
 */
import type { PlayerInputRegistry } from './contract'
import { isValidLayeredKey } from './ui'

export type PlayerKey = keyof PlayerInputRegistry

/** 资源引用最小形态：kind 标识资源类别，ref 由插件自决（URL/path 均可）。 */
export interface ResourceRef {
  readonly kind: string
  readonly ref: string
}

/** 内容来源引用：(sourceId, externalId) 定位插件域原始实体。 */
export interface ContentSourceRef {
  readonly sourceId: string
  readonly externalId: string
}

/** 创作者引用。 */
export interface CreatorRef {
  readonly creatorId: string
  readonly displayName: string
  readonly avatar?: ResourceRef
}

/**
 * Item 公共字段（DB 归一化后由 Repository 组装）。
 * id 在 surface 内全局去重键；createdAt/updatedAt 为 epoch 毫秒。
 */
export interface Item {
  readonly id: string
  readonly title: string
  readonly preview?: ResourceRef
  readonly playerKey: PlayerKey
  readonly sourceRefs: readonly ContentSourceRef[]
  readonly creatorRefs: readonly CreatorRef[]
  readonly viewCount?: number
  readonly createdAt: number
  readonly updatedAt: number
}

/**
 * Item 快照：playerKey 放宽为 string 的存储形态。
 * 历史 / 书架等本地域持久化完整 Item 时使用；
 * Item 结构性可赋给 ItemSnapshot，序列化边界集中在 serializeItemSnapshot / parseItemSnapshot。
 */
export interface ItemSnapshot {
  readonly id: string
  readonly title: string
  readonly preview?: ResourceRef
  readonly playerKey: string
  readonly sourceRefs: readonly ContentSourceRef[]
  readonly creatorRefs: readonly CreatorRef[]
  readonly viewCount?: number
  readonly createdAt: number
  readonly updatedAt: number
}

const isRecordLike = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isResourceRef = (value: unknown): value is ResourceRef =>
  isRecordLike(value) && typeof value.kind === 'string' && typeof value.ref === 'string'

const isContentSourceRef = (value: unknown): value is ContentSourceRef =>
  isRecordLike(value) && typeof value.sourceId === 'string' && typeof value.externalId === 'string'

const isCreatorRef = (value: unknown): value is CreatorRef =>
  isRecordLike(value) &&
  typeof value.creatorId === 'string' &&
  typeof value.displayName === 'string' &&
  (value.avatar === undefined || isResourceRef(value.avatar))

/**
 * 快照 -> JSON。Item 结构性可赋给 ItemSnapshot，调用方持完整类型时直接透传。
 */
export const serializeItemSnapshot = (item: ItemSnapshot): string => JSON.stringify(item)

/**
 * 快照 JSON -> ItemSnapshot；payload 由 serializeItemSnapshot 写入，
 * 字段级校验失败返回 undefined（存储边界容错）。
 */
export const parseItemSnapshot = (payloadJson: string): ItemSnapshot | undefined => {
  let value: unknown
  try {
    value = JSON.parse(payloadJson)
  } catch {
    return undefined
  }
  if (!isRecordLike(value)) return undefined
  const {
    id,
    title,
    preview,
    playerKey,
    sourceRefs,
    creatorRefs,
    viewCount,
    createdAt,
    updatedAt,
  } = value
  if (
    typeof id !== 'string' ||
    typeof title !== 'string' ||
    typeof playerKey !== 'string' ||
    typeof createdAt !== 'number' ||
    typeof updatedAt !== 'number'
  ) {
    return undefined
  }
  if (!Array.isArray(sourceRefs) || !sourceRefs.every(isContentSourceRef)) return undefined
  if (!Array.isArray(creatorRefs) || !creatorRefs.every(isCreatorRef)) return undefined
  if (preview !== undefined && !isResourceRef(preview)) return undefined
  if (viewCount !== undefined && typeof viewCount !== 'number') return undefined
  return {
    id,
    title,
    ...(preview === undefined ? {} : { preview }),
    playerKey,
    sourceRefs,
    creatorRefs,
    ...(viewCount === undefined ? {} : { viewCount }),
    createdAt,
    updatedAt,
  }
}

/** 单次取页结果：hasMore=false 时 cursor 应省略。 */
export interface ItemPage {
  readonly items: readonly Item[]
  /** 本页续取游标，语义由 provider 自决。 */
  readonly cursor?: string
  readonly hasMore: boolean
}

/** FeedProvider：一个 surface 内按 key 唯一，独立维护 cursor 分页。 */
export interface FeedProvider {
  readonly key: string
  fetch(cursor?: string): Promise<ItemPage>
}

/** FeedSurface 描述符：对应一个二级 Tab。id 遵循分层 key 形态 'plugin-id/surface-name'。 */
export interface FeedSurfaceDescriptor {
  readonly id: string
  readonly title: string
  readonly providers: readonly FeedProvider[]
}

/** 校验 surface id：与 UI 分层 key 同形态约定。 */
export const isValidSurfaceId = isValidLayeredKey

/** 动作执行上下文：携带目标 item 与动作触发场景标识。 */
export interface ItemActionContext {
  readonly item: Item
  /** 触发场景：'card-more'（卡片 ⋮）等，供 provider 区分呈现位置。 */
  readonly source: string
}

export interface ItemAction {
  /** provider 内唯一动作 key。 */
  readonly key: string
  readonly label: string
  execute(context: ItemActionContext): void | Promise<void>
}

/**
 * ItemActionProvider：applies 缺省视为全适用；
 * getActions 返回顺序即菜单顺序。
 */
export interface ItemActionProvider {
  readonly id: string
  applies?(item: Item): boolean
  getActions(item: Item, context: ItemActionContext): readonly ItemAction[]
}