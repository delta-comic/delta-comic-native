import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ItemSnapshot } from '@delta-comic/protocol'

import { ShelfService } from '../lib/service'

import { createContext, createTestDb, type TestDb } from './util'

const snapshotOf = (id: string): ItemSnapshot => ({
  id,
  title: `标题 ${id}`,
  playerKey: 'sample/player',
  sourceRefs: [],
  creatorRefs: [],
  createdAt: 1,
  updatedAt: 1,
})

describe('ShelfService', () => {
  let testDb: TestDb
  let currentMs: number

  beforeEach(async () => {
    testDb = await createTestDb()
    currentMs = 1_700_000_000_000
  })

  afterEach(async () => {
    await testDb.destroy()
  })

  const clock = () => currentMs

  const createService = () => new ShelfService(createContext(), testDb.db, { now: clock })

  it('add 收录后可跨分区共存同一 item', async () => {
    const service = createService()
    const favorite = await service.add('favorite', snapshotOf('item-1'))
    expect(favorite).toMatchObject({ kind: 'favorite', itemId: 'item-1', title: '标题 item-1' })
    expect(favorite.item?.id).toBe('item-1')

    await service.add('later', snapshotOf('item-1'))
    expect(await service.has('favorite', 'item-1')).toBe(true)
    expect(await service.has('later', 'item-1')).toBe(true)
  })

  it('add 重复收录同分区抛错', async () => {
    const service = createService()
    await service.add('favorite', snapshotOf('item-1'))
    await expect(service.add('favorite', snapshotOf('item-1'))).rejects.toThrow('书架条目已存在')
  })

  it('list 分区过滤且按创建倒序', async () => {
    const service = createService()
    await service.add('favorite', snapshotOf('a'))
    currentMs += 1_000
    await service.add('later', snapshotOf('b'))
    currentMs += 1_000
    await service.add('favorite', snapshotOf('c'))
    expect((await service.list()).map(entry => `${entry.kind}/${entry.itemId}`)).toEqual([
      'favorite/c',
      'later/b',
      'favorite/a',
    ])
    expect((await service.list('favorite')).map(entry => entry.itemId)).toEqual(['c', 'a'])
  })

  it('remove 校验目标并广播事件', async () => {
    const ctx = createContext()
    const onChanged = vi.fn<() => void>()
    ctx.on('library/shelf-changed', onChanged)
    const service = new ShelfService(ctx, testDb.db, { now: clock })
    await service.add('later', snapshotOf('item-1'))
    await service.remove('later', 'item-1')
    expect(await service.has('later', 'item-1')).toBe(false)
    expect(onChanged).toHaveBeenCalledTimes(2)
    await expect(service.remove('later', 'item-1')).rejects.toThrow('书架条目不存在')
    await expect(service.add('favorite', snapshotOf(' '))).rejects.toThrow(TypeError)
  })
})
