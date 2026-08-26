/**
 * 搜索服务：SearchProvider 全局注册表与统一搜索入口（architecture.md §4）。
 *
 * - provider id 遵循分层 key 形态 'plugin-id/provider-name'，全局唯一
 * - search 统一保证 query trim 后非空，分页委托给 provider 自决 cursor
 */
import { isValidSearchProviderId, type ItemPage, type SearchProvider } from '@delta-comic/protocol'
import { Service, type Context, type Disposable } from 'cordis'

/** provider 只读投影（SearchPage 单选数据源）。 */
export interface SearchProviderProjection {
  readonly id: string
  readonly label?: string
}

export class SearchService extends Service {
  private readonly providersById = new Map<string, SearchProvider>()

  constructor(ctx: Context) {
    super(ctx, 'search')
  }

  /** 注册 provider；id 非法或重复注册抛错。返回注销 disposer。 */
  register(provider: SearchProvider): Disposable {
    if (!isValidSearchProviderId(provider.id)) {
      throw new TypeError(`非法 SearchProvider id：${provider.id}`)
    }
    if (this.providersById.has(provider.id)) {
      throw new Error(`SearchProvider 重复注册：${provider.id}`)
    }
    this.providersById.set(provider.id, provider)
    this.ctx.emit('search/providers-changed')
    return () => {
      this.providersById.delete(provider.id)
      this.ctx.emit('search/providers-changed')
    }
  }

  /** 全部已注册 provider 投影，按注册顺序排列。 */
  providers(): readonly SearchProviderProjection[] {
    return [...this.providersById.values()].map(provider => ({
      id: provider.id,
      label: provider.label,
    }))
  }

  /** 执行搜索；query trim 后为空抛 TypeError，provider 未注册抛错。 */
  async search(providerId: string, query: string, cursor?: string): Promise<ItemPage> {
    const trimmed = query.trim()
    if (trimmed.length === 0) throw new TypeError('搜索关键词不能为空')
    const provider = this.providersById.get(providerId)
    if (provider === undefined) throw new Error(`SearchProvider 未注册：${providerId}`)
    return provider.search(trimmed, cursor)
  }
}

declare module 'cordis' {
  interface Context {
    search: SearchService
  }

  interface Events {
    /** SearchProvider 注册集合变更广播。 @mode emit */
    'search/providers-changed'(): void
  }
}