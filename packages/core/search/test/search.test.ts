import type { ItemPage, SearchProvider } from '@delta-comic/protocol'
import { Context } from 'cordis'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'

import { SearchService } from '../lib/service'

declare module '@delta-comic/protocol' {
  interface PlayerInputRegistry {
    'sample/player': { readonly schema: ReturnType<typeof testSchema>; readonly version: '1' }
  }
}

function testSchema() {
  return Type.Object({ id: Type.String() })
}

const pageOf = (title: string): ItemPage => ({
  items: [
    {
      id: title,
      title,
      playerKey: 'sample/player',
      sourceRefs: [],
      creatorRefs: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  hasMore: false,
})

const provider = (id: string): SearchProvider => ({
  id,
  label: id.split('/')[1],
  search: async query => pageOf(query),
})

describe('SearchService', () => {
  it('注册后投影 providers 并广播变更，注销移除', () => {
    const ctx = new Context()
    const service = new SearchService(ctx)
    const onChanged = vi.fn<() => void>()
    ctx.on('search/providers-changed', onChanged)

    const dispose = service.register(provider('sample/comic'))
    expect(service.providers()).toEqual([{ id: 'sample/comic', label: 'comic' }])
    expect(onChanged).toHaveBeenCalledTimes(1)

    dispose()
    expect(service.providers()).toEqual([])
    expect(onChanged).toHaveBeenCalledTimes(2)
  })

  it('非法或重复 id 抛错', () => {
    const service = new SearchService(new Context())
    expect(() => service.register(provider('flat'))).toThrow('非法 SearchProvider id')
    service.register(provider('a/one'))
    expect(() => service.register(provider('a/one'))).toThrow('重复注册')
  })

  it('search 委托 provider 并保证 trim', async () => {
    const service = new SearchService(new Context())
    const target = provider('a/one')
    const spy = vi.spyOn(target, 'search')
    service.register(target)
    await expect(service.search('a/one', '  海贼王 ', undefined)).resolves.toMatchObject({
      items: [{ title: '海贼王' }],
    })
    expect(spy).toHaveBeenCalledWith('海贼王', undefined)
  })

  it('空关键词与未注册 provider 抛错', async () => {
    const service = new SearchService(new Context())
    await expect(service.search('a/one', '   ')).rejects.toMatchObject({ name: 'TypeError' })
    await expect(service.search('a/one', '词')).rejects.toThrow('未注册')
  })

  it('cursor 透传 provider 支持翻页', async () => {
    const paged: SearchProvider = {
      id: 'a/paged',
      search: async (query, cursor) => ({ ...pageOf(query), cursor: cursor ?? '1', hasMore: true }),
    }
    const service = new SearchService(new Context())
    service.register(paged)
    const first = await service.search('a/paged', 'x')
    expect(first.cursor).toBe('1')
    const second = await service.search('a/paged', 'x', first.cursor)
    expect(second.cursor).toBe('1')
  })
})