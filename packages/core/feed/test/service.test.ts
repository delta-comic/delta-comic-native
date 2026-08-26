import type {
  FeedProvider,
  FeedSurfaceDescriptor,
  Item,
  ItemActionProvider,
} from '@delta-comic/protocol'
import { Context } from 'cordis'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import { FeedService, ItemActionService } from '../lib/index'
import { FeedSession } from '../lib/session'

declare module '@delta-comic/protocol' {
  interface PlayerInputRegistry {
    'test/player': { readonly schema: ReturnType<typeof testSchema>; readonly version: '1' }
  }
}

function testSchema() {
  return Type.Object({ id: Type.String() })
}

function makeItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    title: `标题 ${id}`,
    playerKey: 'test/player',
    sourceRefs: [{ sourceId: 'src', externalId: id }],
    creatorRefs: [],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

function stubProvider(key: string): FeedProvider {
  return { key, fetch: async () => ({ items: [], hasMore: false }) }
}

function surfaceOf(overrides: Partial<FeedSurfaceDescriptor> = {}): FeedSurfaceDescriptor {
  return { id: 'home/recommend', title: '推荐', providers: [stubProvider('alpha')], ...overrides }
}

function createFeedService() {
  return new FeedService(new Context())
}

describe('FeedService', () => {
  it('非法 surface id 抛 TypeError', () => {
    const service = createFeedService()
    expect(() => service.registerSurface(surfaceOf({ id: 'recommend' }))).toThrow(TypeError)
  })

  it('空 providers 抛错', () => {
    const service = createFeedService()
    expect(() => service.registerSurface(surfaceOf({ providers: [] }))).toThrow(TypeError)
  })

  it('provider key 重复抛错', () => {
    const service = createFeedService()
    expect(() =>
      service.registerSurface(
        surfaceOf({ providers: [stubProvider('same'), stubProvider('same')] }),
      ),
    ).toThrow(TypeError)
  })

  it('同 id 重复注册抛错', () => {
    const service = createFeedService()
    service.registerSurface(surfaceOf())
    expect(() => service.registerSurface(surfaceOf())).toThrow('重复注册')
  })

  it('surfaces 按注册序投影，注销后同步消失', () => {
    const service = createFeedService()
    const dispose = service.registerSurface(
      surfaceOf({
        id: 'home/follow',
        title: '关注',
        providers: [stubProvider('b'), stubProvider('c')],
      }),
    )
    service.registerSurface(surfaceOf())
    expect(service.surfaces()).toEqual([
      { id: 'home/follow', title: '关注', providerKeys: ['b', 'c'] },
      { id: 'home/recommend', title: '推荐', providerKeys: ['alpha'] },
    ])
    dispose()
    expect(service.surfaces().map(surface => surface.id)).toEqual(['home/recommend'])
  })

  it('未注册 surface 的 createSession 报错，注册后返回会话', () => {
    const service = createFeedService()
    expect(() => service.createSession('home/recommend')).toThrow('未注册')
    service.registerSurface(surfaceOf())
    const session = service.createSession('home/recommend', { seed: 's' })
    expect(session).toBeInstanceOf(FeedSession)
    expect(session.getSnapshot().seed).toBe('s')
  })

  it('注册与注销均广播 feed/surface-changed', () => {
    const ctx = new Context()
    const service = new FeedService(ctx)
    const seen: string[] = []
    ctx.on('feed/surface-changed', id => {
      seen.push(id)
    })
    const dispose = service.registerSurface(surfaceOf())
    dispose()
    expect(seen).toEqual(['home/recommend', 'home/recommend'])
  })
})

function actionProviderOf(provider: ItemActionProvider): ItemActionProvider {
  return provider
}

describe('ItemActionService', () => {
  it('无 applies 的 provider 对全部 item 适用', () => {
    const service = new ItemActionService(new Context())
    service.registerProvider(
      actionProviderOf({
        id: 'core',
        getActions: item => [{ key: 'share', label: `分享 ${item.id}`, execute: async () => {} }],
      }),
    )
    const actions = service.resolveActions(makeItem('i1'), 'card-more')
    expect(actions.map(action => action.key)).toEqual(['share'])
  })

  it('applies 过滤不适用的 provider', () => {
    const service = new ItemActionService(new Context())
    service.registerProvider(
      actionProviderOf({
        id: 'video-only',
        applies: item => item.viewCount !== undefined,
        getActions: () => [{ key: 'loop', label: '循环播放', execute: async () => {} }],
      }),
    )
    expect(service.resolveActions(makeItem('plain'), 'card-more')).toHaveLength(0)
    expect(service.resolveActions(makeItem('viewed', { viewCount: 3 }), 'card-more')).toHaveLength(
      1,
    )
  })

  it('动作顺序 = provider 注册序内各 provider 返回序', () => {
    const service = new ItemActionService(new Context())
    service.registerProvider(
      actionProviderOf({
        id: 'first',
        getActions: () => [
          { key: 'a1', label: 'A1', execute: async () => {} },
          { key: 'a2', label: 'A2', execute: async () => {} },
        ],
      }),
    )
    service.registerProvider(
      actionProviderOf({
        id: 'second',
        getActions: () => [{ key: 'b1', label: 'B1', execute: async () => {} }],
      }),
    )
    expect(service.resolveActions(makeItem('i1'), 'card-more').map(action => action.key)).toEqual([
      'a1',
      'a2',
      'b1',
    ])
  })

  it('注销后 provider 不再参与解析', () => {
    const service = new ItemActionService(new Context())
    const dispose = service.registerProvider(
      actionProviderOf({
        id: 'temp',
        getActions: () => [{ key: 'x', label: 'X', execute: async () => {} }],
      }),
    )
    expect(service.resolveActions(makeItem('i1'), 'card-more')).toHaveLength(1)
    dispose()
    expect(service.resolveActions(makeItem('i1'), 'card-more')).toHaveLength(0)
  })

  it('同 id 重复注册抛错', () => {
    const service = new ItemActionService(new Context())
    service.registerProvider(actionProviderOf({ id: 'dup', getActions: () => [] }))
    expect(() =>
      service.registerProvider(actionProviderOf({ id: 'dup', getActions: () => [] })),
    ).toThrow('重复注册')
  })
})