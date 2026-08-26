import type { ItemSnapshot } from '@delta-comic/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HistoryService } from '../lib/service'

import { createContext, createTestDb, type TestDb } from './util'

const snapshotOf = (id: string, overrides: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  id,
  title: `标题 ${id}`,
  playerKey: 'sample/player',
  sourceRefs: [],
  creatorRefs: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
})

describe('HistoryService', () => {
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

  const createService = () => new HistoryService(createContext(), testDb.db, { now: clock })

  it('recordOpen 新增计数与时间戳，重复打开累加并保留首次时间', async () => {
    const service = createService()
    await service.recordOpen(snapshotOf('item-1'))
    const first = await service.get('item-1')
    expect(first).toMatchObject({ itemId: 'item-1', title: '标题 item-1', openedCount: 1 })
    expect(first?.item).toEqual(snapshotOf('item-1'))

    currentMs += 60_000
    await service.recordOpen(snapshotOf('item-1'))
    const second = await service.get('item-1')
    expect(second).toMatchObject({ openedCount: 2 })
    expect(second?.firstOpenedAt).toBe(first?.firstOpenedAt)
    expect(second?.lastOpenedAt).not.toBe(first?.lastOpenedAt)
  })

  it('recordOpen 刷新标题与快照', async () => {
    const service = createService()
    await service.recordOpen(snapshotOf('item-1'))
    await service.recordOpen(snapshotOf('item-1', { title: '新标题' }))
    const entry = await service.get('item-1')
    expect(entry?.title).toBe('新标题')
    expect(entry?.item?.title).toBe('新标题')
    expect(entry?.openedCount).toBe(2)
  })

  it('updateProgress 写入进度且保留计数', async () => {
    const service = createService()
    await service.recordOpen(snapshotOf('item-1'))
    await service.updateProgress('item-1', { json: '{"page":3}', ratio: 0.5 })
    const entry = await service.get('item-1')
    expect(entry?.progressJson).toBe('{"page":3}')
    expect(entry?.progressRatio).toBe(0.5)
    expect(entry?.openedCount).toBe(1)

    await expect(service.updateProgress('missing', { ratio: 0.5 })).rejects.toThrow(
      '历史记录不存在',
    )
    await expect(service.updateProgress('item-1', { ratio: 1.5 })).rejects.toThrow(TypeError)
    await expect(service.updateProgress('item-1', {})).rejects.toThrow(TypeError)
  })

  it('list 按最近打开倒序且 limit 截断', async () => {
    const service = createService()
    await service.recordOpen(snapshotOf('a'))
    currentMs += 1_000
    await service.recordOpen(snapshotOf('b'))
    currentMs += 1_000
    await service.recordOpen(snapshotOf('c'))
    expect((await service.list()).map(entry => entry.itemId)).toEqual(['c', 'b', 'a'])
    expect((await service.list({ limit: 2 })).map(entry => entry.itemId)).toEqual(['c', 'b'])
    await expect(service.list({ limit: 0 })).rejects.toThrow(TypeError)
  })

  it('payload 损坏时条目保留但快照缺省', async () => {
    const service = createService()
    await service.recordOpen(snapshotOf('a'))
    await testDb.db
      .updateTable('item_history')
      .set({ payload_json: '{broken' })
      .where('item_id', '=', 'a')
      .execute()
    const entry = await service.get('a')
    expect(entry?.item).toBeUndefined()
    expect(entry?.title).toBe('标题 a')
  })

  it('remove 与 clear 清空并广播事件', async () => {
    const ctx = createContext()
    const onChanged = vi.fn<() => void>()
    ctx.on('library/history-changed', onChanged)
    const service = new HistoryService(ctx, testDb.db, { now: clock })
    await service.recordOpen(snapshotOf('a'))
    await service.recordOpen(snapshotOf('b'))
    await service.remove('a')
    expect((await service.list()).map(entry => entry.itemId)).toEqual(['b'])
    await service.clear()
    expect(await service.list()).toEqual([])
    expect(onChanged).toHaveBeenCalledTimes(4)
    await expect(service.recordOpen(snapshotOf(' '))).rejects.toThrow(TypeError)
  })
})