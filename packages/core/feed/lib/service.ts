/**
 * Feed 服务与 ItemAction 服务。
 *
 * - FeedService：surface 注册表 + 会话工厂；注册集合变更经 Events 广播
 * - ItemActionService：动作 provider 注册与菜单解析，顺序 = 注册序内返回序
 */
import {
  isValidSurfaceId,
  type FeedSurfaceDescriptor,
  type Item,
  type ItemAction,
  type ItemActionContext,
  type ItemActionProvider,
} from '@delta-comic/protocol'
import { Service, type Context, type Disposable } from 'cordis'

import { FeedSession, type FeedSessionOptions } from './session'

/** surface 只读投影（调试通道与二级 Tab 数据源）。 */
export interface FeedSurfaceProjection {
  readonly id: string
  readonly title: string
  readonly providerKeys: readonly string[]
}

export class FeedService extends Service {
  private readonly surfaceById = new Map<string, FeedSurfaceDescriptor>()

  constructor(ctx: Context) {
    super(ctx, 'feed')
  }

  /** 注册一个 FeedSurface（对应一个二级 Tab）；返回注销 disposer。 */
  registerSurface(descriptor: FeedSurfaceDescriptor): Disposable {
    if (!isValidSurfaceId(descriptor.id)) {
      throw new TypeError(`非法 surface id：${descriptor.id}`)
    }
    if (descriptor.providers.length === 0) {
      throw new TypeError(`FeedSurface ${descriptor.id} 至少需要一个 provider`)
    }
    const keys = new Set<string>()
    for (const provider of descriptor.providers) {
      if (keys.has(provider.key)) {
        throw new TypeError(`provider key 重复：${descriptor.id}/${provider.key}`)
      }
      keys.add(provider.key)
    }
    if (this.surfaceById.has(descriptor.id)) {
      throw new Error(`FeedSurface 重复注册：${descriptor.id}`)
    }
    this.surfaceById.set(descriptor.id, descriptor)
    this.ctx.emit('feed/surface-changed', descriptor.id)
    return () => {
      this.surfaceById.delete(descriptor.id)
      this.ctx.emit('feed/surface-changed', descriptor.id)
    }
  }

  /** 全部已注册 surface 投影，按注册顺序排列。 */
  surfaces(): readonly FeedSurfaceProjection[] {
    return [...this.surfaceById.values()].map(descriptor => ({
      id: descriptor.id,
      title: descriptor.title,
      providerKeys: descriptor.providers.map(provider => provider.key),
    }))
  }

  /** 为指定 surface 创建聚合会话；同一 surface 可并存多个会话。 */
  createSession(surfaceId: string, options?: FeedSessionOptions): FeedSession {
    const descriptor = this.surfaceById.get(surfaceId)
    if (descriptor === undefined) throw new Error(`FeedSurface 未注册：${surfaceId}`)
    return new FeedSession(descriptor, options)
  }
}

export class ItemActionService extends Service {
  private readonly providers: ItemActionProvider[] = []

  constructor(ctx: Context) {
    super(ctx, 'itemActions')
  }

  /** 注册动作 provider；同 id 重复注册报错。返回注销 disposer。 */
  registerProvider(provider: ItemActionProvider): Disposable {
    if (this.providers.some(existing => existing.id === provider.id)) {
      throw new Error(`ItemActionProvider 重复注册：${provider.id}`)
    }
    this.providers.push(provider)
    return () => {
      const index = this.providers.indexOf(provider)
      if (index >= 0) this.providers.splice(index, 1)
    }
  }

  /** 解析 item 可用动作：applies 过滤后按注册序拼接各 provider 返回序。 */
  resolveActions(item: Item, source: string): readonly ItemAction[] {
    const context: ItemActionContext = { item, source }
    const actions: ItemAction[] = []
    for (const provider of this.providers) {
      if (provider.applies !== undefined && !provider.applies(item)) continue
      actions.push(...provider.getActions(item, context))
    }
    return actions
  }
}

declare module 'cordis' {
  interface Context {
    feed: FeedService
    itemActions: ItemActionService
  }

  interface Events {
    /** FeedSurface 注册集合变更广播（注册与注销均触发）。 @mode emit */
    'feed/surface-changed'(id: string): void
  }
}