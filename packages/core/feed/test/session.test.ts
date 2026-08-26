import type { FeedProvider, FeedSurfaceDescriptor, Item, ItemPage } from '@delta-comic/protocol'
import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import { itemRank } from '../lib/seed'
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

function pageOf(items: readonly Item[], cursor?: string, hasMore = cursor !== undefined): ItemPage {
  return { items, ...(cursor === undefined ? {} : { cursor }), hasMore }
}

interface ProviderSpec {
  readonly key: string
  /** 按 fetch 调用序返回页；字符串表示抛错。 */
  readonly pages: readonly (ItemPage | string)[]
}

function providerOf(spec: ProviderSpec): FeedProvider & { readonly calls: number } {
  const state = { calls: 0 }
  return {
    key: spec.key,
    get calls() {
      return state.calls
    },
    async fetch(cursor?: string) {
      const page = spec.pages[Math.min(state.calls, spec.pages.length - 1)]
      state.calls += 1
      if (typeof page === 'string') throw new Error(page)
      void cursor
      return page
    },
  }
}

function surfaceOf(providers: readonly FeedProvider[]): FeedSurfaceDescriptor {
  return { id: 'plugin-a/main', title: '推荐', providers }
}

describe('FeedSession', () => {
  it('初始快照为 idle 空列表', () => {
    const session = new FeedSession(surfaceOf([providerOf({ key: 'a', pages: [] })]), { seed: 's' })
    expect(session.getSnapshot()).toMatchObject({
      seed: 's',
      entries: [],
      phase: 'idle',
      lastRoundPartialFailure: false,
    })
  })

  it('多 provider 合并并按 seed 分值降序', async () => {
    const session = new FeedSession(
      surfaceOf([
        providerOf({
          key: 'alpha',
          pages: [pageOf([makeItem('i1'), makeItem('i2')], undefined, false)],
        }),
        providerOf({ key: 'beta', pages: [pageOf([makeItem('i3')], undefined, false)] }),
      ]),
      { seed: 'fixed' },
    )
    await session.loadMore()
    const snapshot = session.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.entries.map(entry => entry.item.id)).toEqual(
      [...snapshot.entries].sort((x, y) => y.rank - x.rank).map(entry => entry.item.id),
    )
    for (const entry of snapshot.entries) {
      expect(entry.rank).toBe(itemRank('fixed', entry.providerKey, entry.item.id))
    }
  })

  it('跨 provider 同 id 去重保留分值更高者', async () => {
    const session = new FeedSession(
      surfaceOf([
        providerOf({ key: 'low', pages: [pageOf([makeItem('dup')], undefined, false)] }),
        providerOf({ key: 'high', pages: [pageOf([makeItem('dup')], undefined, false)] }),
      ]),
      { seed: 'fixed' },
    )
    await session.loadMore()
    const entries = session.getSnapshot().entries
    expect(entries).toHaveLength(1)
    const expected =
      itemRank('fixed', 'high', 'dup') > itemRank('fixed', 'low', 'dup') ? 'high' : 'low'
    expect(entries[0].providerKey).toBe(expected)
  })

  it('部分 provider 失败独立标记且整体 ready', async () => {
    const session = new FeedSession(
      surfaceOf([
        providerOf({ key: 'ok', pages: [pageOf([makeItem('i1')], undefined, false)] }),
        providerOf({ key: 'boom', pages: ['网络错误'] }),
      ]),
      { seed: 's' },
    )
    await session.loadMore()
    const snapshot = session.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.lastRoundPartialFailure).toBe(true)
    expect(snapshot.providers).toContainEqual(
      expect.objectContaining({ key: 'boom', status: 'error', error: '网络错误' }),
    )
    expect(snapshot.entries.map(entry => entry.item.id)).toEqual(['i1'])
  })

  it('retry 仅恢复指定 provider', async () => {
    let failBoom = true
    const boom: FeedProvider = {
      key: 'boom',
      async fetch() {
        if (failBoom) throw new Error('失败')
        return pageOf([makeItem('i2')], undefined, false)
      },
    }
    const session = new FeedSession(
      surfaceOf([providerOf({ key: 'ok', pages: [pageOf([], undefined, false)] }), boom]),
      { seed: 's' },
    )
    await session.loadMore()
    const partial = session.getSnapshot()
    expect(partial.phase).toBe('ready')
    expect(partial.lastRoundPartialFailure).toBe(true)
    failBoom = false
    await session.retry('boom')
    const snapshot = session.getSnapshot()
    expect(snapshot.phase).toBe('ready')
    expect(snapshot.entries.map(entry => entry.item.id)).toContain('i2')
  })

  it('全部失败进入整体 error', async () => {
    const session = new FeedSession(
      surfaceOf([
        providerOf({ key: 'a', pages: ['故障 A'] }),
        providerOf({ key: 'b', pages: ['故障 B'] }),
      ]),
      { seed: 's' },
    )
    await session.loadMore()
    const snapshot = session.getSnapshot()
    expect(snapshot.phase).toBe('error')
    expect(snapshot.entries).toHaveLength(0)
    expect(snapshot.providers.every(provider => provider.status === 'error')).toBe(true)
  })

  it('cursor 独立续取且 hasMore=false 后退出轮转', async () => {
    const alpha = providerOf({
      key: 'alpha',
      pages: [pageOf([makeItem('a1')], 'cursor-1'), pageOf([makeItem('a2')], undefined, false)],
    })
    const beta = providerOf({ key: 'beta', pages: [pageOf([], undefined, false)] })
    const session = new FeedSession(surfaceOf([alpha, beta]), { seed: 's' })
    await session.loadMore()
    const firstRound = session.getSnapshot().entries.map(entry => entry.item.id)
    expect(firstRound).toContain('a1')
    await session.loadMore()
    const snapshot = session.getSnapshot()
    expect(snapshot.entries).toHaveLength(2)
    expect(snapshot.entries.map(entry => entry.item.id)).toEqual(
      [...snapshot.entries].sort((x, y) => y.rank - x.rank).map(entry => entry.item.id),
    )
    // 双方均已无更多内容，再触发为空轮次
    await session.loadMore()
    expect(session.getSnapshot().entries).toHaveLength(2)
    expect(alpha.calls).toBe(2)
    expect(beta.calls).toBe(1)
  })

  it('refresh 换 seed 并清空聚合', async () => {
    let seedSequence = 0
    const session = new FeedSession(
      surfaceOf([providerOf({ key: 'a', pages: [pageOf([makeItem('i1')], undefined, false)] })]),
      { seed: 'initial', newSeed: () => `next-${(seedSequence += 1)}` },
    )
    await session.loadMore()
    await session.refresh()
    const snapshot = session.getSnapshot()
    expect(snapshot.seed).toBe('next-1')
    expect(snapshot.entries).toHaveLength(1)
  })

  it('subscribe 在状态变更时收到通知', async () => {
    const session = new FeedSession(
      surfaceOf([providerOf({ key: 'a', pages: [pageOf([makeItem('i1')], undefined, false)] })]),
      { seed: 's' },
    )
    let notifications = 0
    const dispose = session.subscribe(() => {
      notifications += 1
    })
    await session.loadMore()
    expect(notifications).toBeGreaterThan(0)
    dispose()
    const before = notifications
    await session.refresh()
    expect(notifications).toBe(before)
  })

  it('provider key 冲突在构造期报错', () => {
    expect(
      () =>
        new FeedSession(
          surfaceOf([
            providerOf({ key: 'same', pages: [] }),
            providerOf({ key: 'same', pages: [] }),
          ]),
        ),
    ).toThrow('重复')
  })

  it('进行中的 loadMore 复用同一 promise', () => {
    let release: ((page: ItemPage) => void) | undefined
    const gate: FeedProvider = {
      key: 'gate',
      fetch: () =>
        new Promise(resolve => {
          release = resolve
        }),
    }
    const session = new FeedSession(surfaceOf([gate]), { seed: 's' })
    const first = session.loadMore()
    expect(session.loadMore()).toBe(first)
    release?.(pageOf([], undefined, false))
    return first
  })
})