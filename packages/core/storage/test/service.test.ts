import { describe, expect, it, vi } from 'vitest'

import { createMemoryLayer, createStorage } from './util'

describe('storage usage', () => {
  it('聚合多层数量与字节', async () => {
    const { service } = await createStorage()
    const cache = createMemoryLayer('image-cache', 'volatile')
    const downloads = createMemoryLayer('downloads', 'persistent')
    cache.put('a', 10, 1)
    cache.put('b', 20, 2)
    downloads.put('c', 40, 3)
    const d1 = service.registerLayer(cache.adapter)
    const d2 = service.registerLayer(downloads.adapter)
    const report = await service.usage()
    expect(report.totalBytes).toBe(70)
    expect(report.layers).toEqual([
      { id: 'image-cache', kind: 'volatile', objectCount: 2, totalBytes: 30 },
      { id: 'downloads', kind: 'persistent', objectCount: 1, totalBytes: 40 },
    ])
    d1()
    d2()
  })

  it('重复注册抛错，disposer 注销后不再统计', async () => {
    const { service } = await createStorage()
    const layer = createMemoryLayer('dup', 'volatile')
    const dispose = service.registerLayer(layer.adapter)
    expect(() => service.registerLayer(layer.adapter)).toThrow('存储层重复注册：dup')
    dispose()
    dispose()
    const report = await service.usage()
    expect(report.layers).toEqual([])
  })

  it('usage-changed 在注册与注销后触发', async () => {
    const { ctx, service } = await createStorage()
    const listener = vi.fn<(scope: null) => void>()
    ctx.on('storage/usage-changed', listener)
    const layer = createMemoryLayer('l', 'volatile')
    const dispose = service.registerLayer(layer.adapter)
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('storage clearCache', () => {
  it('仅清理易失层，持久层不受影响', async () => {
    const { service } = await createStorage()
    const cache = createMemoryLayer('image-cache', 'volatile')
    const downloads = createMemoryLayer('downloads', 'persistent')
    cache.put('a', 10, 1)
    downloads.put('c', 40, 3)
    service.registerLayer(cache.adapter)
    service.registerLayer(downloads.adapter)
    const results = await service.clearCache()
    expect(results).toEqual([{ layerId: 'image-cache', removedCount: 1, freedBytes: 10 }])
    expect(cache.has('a')).toBe(false)
    expect(downloads.has('c')).toBe(true)
  })

  it('指定 layerId 只清理对应层；未知或持久层抛错', async () => {
    const { service } = await createStorage()
    const cache = createMemoryLayer('cache-a', 'volatile')
    const persistent = createMemoryLayer('downloads', 'persistent')
    service.registerLayer(cache.adapter)
    service.registerLayer(persistent.adapter)
    const results = await service.clearCache('cache-a')
    expect(results.map(r => r.layerId)).toEqual(['cache-a'])
    await expect(service.clearCache('missing')).rejects.toThrow('存储层未注册：missing')
    await expect(service.clearCache('downloads')).rejects.toThrow(
      '持久层不支持 clearCache/enforce：downloads',
    )
  })

  it('空层清理返回零值且不广播', async () => {
    const { ctx, service } = await createStorage()
    const listener = vi.fn<(scope: null) => void>()
    ctx.on('storage/usage-changed', listener)
    const layer = createMemoryLayer('empty', 'volatile')
    service.registerLayer(layer.adapter)
    listener.mockClear()
    const results = await service.enforce('empty')
    expect(results).toEqual([])
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('storage quota', () => {
  it('enforce 按 lastAccessAt 从旧到新驱逐至限额内', async () => {
    const { service } = await createStorage({ quotas: { volatile: 100 } })
    const layer = createMemoryLayer('image-cache', 'volatile')
    layer.put('old', 40, 1)
    layer.put('mid', 40, 2)
    layer.put('new', 40, 3)
    service.registerLayer(layer.adapter)
    const results = await service.enforce()
    expect(results).toEqual([{ layerId: 'image-cache', removedCount: 1, freedBytes: 40 }])
    expect(layer.has('old')).toBe(false)
    expect(layer.has('mid')).toBe(true)
    expect(layer.has('new')).toBe(true)
  })

  it('未设配额的 kind 不驱逐；persistent 层不受约束', async () => {
    const { service } = await createStorage({ quotas: { volatile: 50 } })
    const persistent = createMemoryLayer('downloads', 'persistent')
    persistent.put('big', 9999, 1)
    service.registerLayer(persistent.adapter)
    const results = await service.enforce()
    expect(results).toEqual([])
    expect(persistent.has('big')).toBe(true)
  })

  it('setQuota 动态调整与取消，quotaOf 读取', async () => {
    const { service } = await createStorage({ quotas: { volatile: 100 } })
    expect(service.quotaOf('volatile')).toBe(100)
    expect(service.quotaOf('persistent')).toBeUndefined()
    service.setQuota('volatile', 200)
    expect(service.quotaOf('volatile')).toBe(200)
    service.setQuota('volatile', null)
    expect(service.quotaOf('volatile')).toBeUndefined()
  })

  it('非法配额在构造与 setQuota 时抛错', async () => {
    await expect(createStorage({ quotas: { volatile: -1 } })).rejects.toThrow(
      '非法存储配额 volatile: -1',
    )
    const { service } = await createStorage()
    expect(() => service.setQuota('volatile', 1.5)).toThrow('非法存储配额 volatile: 1.5')
  })

  it('enforce 驱逐后广播 usage-changed', async () => {
    const { ctx, service } = await createStorage({ quotas: { volatile: 50 } })
    const listener = vi.fn<(scope: null) => void>()
    ctx.on('storage/usage-changed', listener)
    const layer = createMemoryLayer('image-cache', 'volatile')
    layer.put('big', 80, 1)
    service.registerLayer(layer.adapter)
    listener.mockClear()
    await service.enforce()
    expect(listener).toHaveBeenCalledOnce()
    expect(layer.has('big')).toBe(false)
  })
})