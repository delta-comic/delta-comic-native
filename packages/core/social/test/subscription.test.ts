import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SubscriptionService } from '../lib/service'

import { createContext, createTestDb, type TestDb } from './util'

describe('SubscriptionService', () => {
  let harness: TestDb
  let service: SubscriptionService

  beforeEach(async () => {
    harness = await createTestDb()
    service = new SubscriptionService(createContext(), harness.db)
  })

  const ref = { kind: 'creator', id: 'c-1' }

  it('默认分组懒创建且幂等，可改名', async () => {
    const first = await service.ensureDefaultGroup()
    expect(first).toMatchObject({ id: 'default', title: '默认分组', sortKey: 0 })
    const again = await service.ensureDefaultGroup()
    expect(again.id).toBe('default')
    await service.renameGroup('default', '常用')
    const groups = await service.listGroups()
    expect(groups.map(group => group.title)).toEqual(['常用'])
  })

  it('createGroup 分配递增 sortKey 并广播事件', async () => {
    await service.createGroup('国漫')
    await service.createGroup('日漫')
    const groups = await service.listGroups()
    expect(groups.map(group => group.title)).toEqual(['默认分组', '国漫', '日漫'])
    expect(groups[1]?.sortKey).toBeLessThan(groups[2]!.sortKey)

    const ctx = createContext()
    const scoped = new SubscriptionService(ctx, harness.db)
    const onChanged = vi.fn<() => void>()
    ctx.on('social/subscriptions-changed', onChanged)
    await scoped.createGroup('另一个')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('createGroup 拒绝空白标题', async () => {
    await expect(service.createGroup('   ')).rejects.toMatchObject({ name: 'TypeError' })
    await expect(service.renameGroup('default', ' ')).rejects.toMatchObject({ name: 'TypeError' })
  })

  it('subscribe 缺省归入默认分组并去重', async () => {
    const created = await service.subscribe(ref)
    expect(created).toMatchObject({ targetKind: 'creator', targetId: 'c-1', groupId: 'default' })
    await expect(service.subscribe(ref)).rejects.toThrow('订阅已存在')
    const list = await service.listSubscriptions()
    expect(list).toHaveLength(1)
  })

  it('subscribe 校验 kind 与目标分组存在性', async () => {
    await expect(service.subscribe({ kind: 'Bad Kind', id: 'x' })).rejects.toMatchObject({
      name: 'TypeError',
    })
    await expect(service.subscribe({ kind: 'creator', id: 'x' }, 'nope')).rejects.toThrow(
      '目标分组不存在',
    )
  })

  it('removeGroup 将组内订阅移入默认分组后删除分组', async () => {
    const groupA = await service.createGroup('A 组')
    const groupB = await service.createGroup('B 组')
    await service.subscribe(ref, groupA.id)
    await service.subscribe({ kind: 'series', id: 's-1' }, groupA.id)
    await service.subscribe({ kind: 'tag', id: 't-1' }, groupB.id)

    await service.removeGroup(groupA.id)

    const groups = await service.listGroups()
    expect(groups.map(group => group.id)).toEqual(['default', groupB.id])
    const defaults = await service.listSubscriptions('default')
    expect(
      defaults.map(subscription => `${subscription.targetKind}/${subscription.targetId}`),
    ).toEqual(['creator/c-1', 'series/s-1'])
    // 追加进默认分组的 sortKey 在既有订阅之后保持递增。
    expect(defaults[0]?.sortKey).toBeLessThan(defaults[1]!.sortKey)
    await expect(service.removeGroup('default')).rejects.toThrow('系统默认分组不可删除')
    await expect(service.removeGroup('missing')).rejects.toThrow('分组不存在')
  })

  it('moveSubscription 移动归属并校验目标', async () => {
    const created = await service.subscribe(ref)
    const group = await service.createGroup('追更')
    await service.moveSubscription(created.id, group.id)
    expect(
      (await service.listSubscriptions(group.id)).map(subscription => subscription.id),
    ).toEqual([created.id])
    expect(await service.listSubscriptions('default')).toEqual([])
    await expect(service.moveSubscription(created.id, 'missing')).rejects.toThrow('目标分组不存在')
    await expect(service.moveSubscription('missing-sub', group.id)).rejects.toThrow('订阅不存在')
  })

  it('unsubscribe 删除订阅并对缺失目标抛错', async () => {
    await service.subscribe(ref)
    await service.unsubscribe('creator', 'c-1')
    expect(await service.listSubscriptions()).toEqual([])
    await expect(service.unsubscribe('creator', 'c-1')).rejects.toThrow('订阅不存在')
  })
})