/**
 * 关注 / 搜索开放体系协议（architecture.md §4）。
 *
 * - 任何 Subscribable 稳定实体（创作者/系列/标签…）经 provider 接入关注体系
 * - 订阅归属与分组为本地用户域数据，由核心层持久化
 * - 内容流统一返回 ItemPage，与 Feed/Search 共享 Item -> Card 渲染链
 */
import type { ItemPage, ResourceRef } from './feed'
import { isValidLayeredKey } from './ui'

/** Subscribable 实体引用：kind 全局唯一标识实体类别，id 由 provider 自决。 */
export interface SubscribableRef {
  readonly kind: string
  readonly id: string
}

/** 关注对象摘要：订阅列表展示所需最小信息。 */
export interface SubscribableSummary {
  readonly ref: SubscribableRef
  readonly title: string
  readonly cover?: ResourceRef
}

/**
 * SubscribableProvider：kind 遵循 kebab-case 且全局唯一。
 * getSummary/getItems 失败时抛错，由调用方呈现对应失败态。
 */
export interface SubscribableProvider {
  readonly kind: string
  getSummary(ref: SubscribableRef): Promise<SubscribableSummary>
  getItems(ref: SubscribableRef, cursor?: string): Promise<ItemPage>
}

const SUBSCRIBABLE_KIND_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const isSubscribableKind = (kind: string): boolean => SUBSCRIBABLE_KIND_PATTERN.test(kind)

/**
 * SearchProvider：全局注册按 id 唯一，id 遵循分层 key 形态 'plugin-id/provider-name'。
 * query 已由搜索服务保证 trim 后非空；cursor 语义由 provider 自决。
 */
export interface SearchProvider {
  readonly id: string
  readonly label?: string
  search(query: string, cursor?: string): Promise<ItemPage>
}

export const isValidSearchProviderId = isValidLayeredKey