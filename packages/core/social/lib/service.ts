import { SnowflakeGenerator, type CoreDatabase } from '@delta-comic/db'
/**
 * 关注域服务：订阅归属管理与 SubscribableProvider 注册表。
 *
 * - 系统默认分组固定 id 'default'，不可删除、可改名；删除分组时订阅移入默认分组
 * - 订阅以 (target_kind, target_id) 唯一；变更后经 Events 广播
 */
import {
  isSubscribableKind,
  type SubscribableProvider,
  type SubscribableRef,
} from '@delta-comic/protocol'
import { Service, type Context, type Disposable } from 'cordis'
import type { Kysely } from 'kysely'

import {
  SubscriptionGroupRepository,
  SubscriptionRepository,
  type SubscriptionEntity,
  type SubscriptionGroupEntity,
} from './repository'

/** 系统默认分组固定 id。 */
export const DEFAULT_GROUP_ID = 'default'

const SNOWFLAKE_EPOCH_MS = 1_767_225_600_000

export class SubscriptionService extends Service {
  private readonly groups: SubscriptionGroupRepository
  private readonly subs: SubscriptionRepository
  private readonly snowflake = new SnowflakeGenerator({ epochMs: SNOWFLAKE_EPOCH_MS })

  constructor(ctx: Context, db: Kysely<CoreDatabase>) {
    super(ctx, 'subscriptions')
    this.groups = new SubscriptionGroupRepository(db)
    this.subs = new SubscriptionRepository(db)
  }

  /** 确保系统默认分组存在（懒创建，幂等）。 */
  async ensureDefaultGroup(): Promise<SubscriptionGroupEntity> {
    const existing = await this.groups.get(DEFAULT_GROUP_ID)
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    const created: SubscriptionGroupEntity = {
      id: DEFAULT_GROUP_ID,
      title: '默认分组',
      sortKey: 0,
      createdAt: now,
      updatedAt: now,
    }
    await this.groups.insert(created)
    return created
  }

  /** 全部分组（含默认分组），按 sort_key 升序。 */
  async listGroups(): Promise<readonly SubscriptionGroupEntity[]> {
    await this.ensureDefaultGroup()
    return this.groups.list()
  }

  async createGroup(title: string): Promise<SubscriptionGroupEntity> {
    const trimmed = title.trim()
    if (trimmed.length === 0) throw new TypeError('分组标题不能为空')
    const now = new Date().toISOString()
    const created: SubscriptionGroupEntity = {
      id: this.snowflake.next(),
      title: trimmed,
      sortKey: (await this.groups.maxSortKey()) + 1,
      createdAt: now,
      updatedAt: now,
    }
    await this.groups.insert(created)
    this.ctx.emit('social/subscriptions-changed')
    return created
  }

  async renameGroup(groupId: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (trimmed.length === 0) throw new TypeError('分组标题不能为空')
    const group = await this.groups.get(groupId)
    if (group === undefined) throw new Error(`分组不存在：${groupId}`)
    await this.groups.rename(groupId, trimmed, new Date().toISOString())
    this.ctx.emit('social/subscriptions-changed')
  }

  /**
   * 删除分组；系统默认分组抛错，组内订阅全部移入默认分组。
   */
  async removeGroup(groupId: string): Promise<void> {
    if (groupId === DEFAULT_GROUP_ID) throw new Error('系统默认分组不可删除')
    const group = await this.groups.get(groupId)
    if (group === undefined) throw new Error(`分组不存在：${groupId}`)
    const fallback = await this.ensureDefaultGroup()
    const members = await this.subs.listByGroup(groupId)
    const now = new Date().toISOString()
    for (const member of members) {
      const sortKey = (await this.subs.maxSortKeyInGroup(fallback.id)) + 1
      await this.subs.update(member.id, { groupId: fallback.id, sortKey, updatedAt: now })
    }
    await this.groups.remove(groupId)
    this.ctx.emit('social/subscriptions-changed')
  }

  /** 订阅一个 Subscribable 实体；(target_kind, target_id) 已存在时抛错。groupId 缺省归入默认分组。 */
  async subscribe(ref: SubscribableRef, groupId?: string): Promise<SubscriptionEntity> {
    if (!isSubscribableKind(ref.kind)) throw new TypeError(`非法 Subscribable kind：${ref.kind}`)
    if (ref.id.trim().length === 0) throw new TypeError('Subscribable id 不能为空')
    const existing = await this.subs.findByTarget(ref.kind, ref.id)
    if (existing !== undefined) {
      throw new Error(`订阅已存在：${ref.kind}/${ref.id}`)
    }
    const resolvedGroupId = groupId ?? DEFAULT_GROUP_ID
    const targetGroup =
      resolvedGroupId === DEFAULT_GROUP_ID
        ? await this.ensureDefaultGroup()
        : await this.groups.get(resolvedGroupId)
    if (targetGroup === undefined) throw new Error(`目标分组不存在：${resolvedGroupId}`)
    const now = new Date().toISOString()
    const created: SubscriptionEntity = {
      id: this.snowflake.next(),
      targetKind: ref.kind,
      targetId: ref.id,
      groupId: targetGroup.id,
      sortKey: (await this.subs.maxSortKeyInGroup(targetGroup.id)) + 1,
      createdAt: now,
      updatedAt: now,
    }
    await this.subs.insert(created)
    this.ctx.emit('social/subscriptions-changed')
    return created
  }

  /** 取消订阅；目标不存在抛错。 */
  async unsubscribe(targetKind: string, targetId: string): Promise<void> {
    const existing = await this.subs.findByTarget(targetKind, targetId)
    if (existing === undefined) throw new Error(`订阅不存在：${targetKind}/${targetId}`)
    await this.subs.remove(existing.id)
    this.ctx.emit('social/subscriptions-changed')
  }

  /** 移动订阅到指定分组。 */
  async moveSubscription(subscriptionId: string, groupId: string): Promise<void> {
    const subscription = await this.subs.get(subscriptionId)
    if (subscription === undefined) throw new Error(`订阅不存在：${subscriptionId}`)
    const targetGroup =
      groupId === DEFAULT_GROUP_ID
        ? await this.ensureDefaultGroup()
        : await this.groups.get(groupId)
    if (targetGroup === undefined) throw new Error(`目标分组不存在：${groupId}`)
    const now = new Date().toISOString()
    await this.subs.update(subscriptionId, {
      groupId: targetGroup.id,
      sortKey: (await this.subs.maxSortKeyInGroup(targetGroup.id)) + 1,
      updatedAt: now,
    })
    this.ctx.emit('social/subscriptions-changed')
  }

  /** 订阅列表；groupId 提供时按组过滤。 */
  async listSubscriptions(groupId?: string): Promise<readonly SubscriptionEntity[]> {
    return groupId === undefined ? this.subs.listAll() : this.subs.listByGroup(groupId)
  }
}

/** 关注 provider 注册表：kind 全局唯一。 */
export class SubscribableRegistryService extends Service {
  private readonly providersByKind = new Map<string, SubscribableProvider>()

  constructor(ctx: Context) {
    super(ctx, 'subscribables')
  }

  /** 注册 provider；kind 非法或重复注册抛错。返回注销 disposer。 */
  register(provider: SubscribableProvider): Disposable {
    if (!isSubscribableKind(provider.kind)) {
      throw new TypeError(`非法 Subscribable kind：${provider.kind}`)
    }
    if (this.providersByKind.has(provider.kind)) {
      throw new Error(`SubscribableProvider kind 重复注册：${provider.kind}`)
    }
    this.providersByKind.set(provider.kind, provider)
    return () => {
      this.providersByKind.delete(provider.kind)
    }
  }

  /** 全部已注册 kind，按注册顺序排列。 */
  kinds(): readonly string[] {
    return [...this.providersByKind.keys()]
  }

  provider(kind: string): SubscribableProvider | undefined {
    return this.providersByKind.get(kind)
  }
}

declare module 'cordis' {
  interface Context {
    subscriptions: SubscriptionService
    subscribables: SubscribableRegistryService
  }

  interface Events {
    /** 订阅集合或分组结构变更广播（增删移与分组操作均触发）。 @mode emit */
    'social/subscriptions-changed'(): void
  }
}