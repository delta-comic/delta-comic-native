import type { SubscribableProvider } from '@delta-comic/protocol'
import { describe, expect, it } from 'vitest'

import { SubscribableRegistryService } from '../lib/service'

import { createContext } from './util'

const providerOf = (kind: string): SubscribableProvider => ({
  kind,
  getSummary: async ref => ({ ref, title: `标题-${ref.id}` }),
  getItems: async () => ({ items: [], hasMore: false }),
})

describe('SubscribableRegistryService', () => {
  it('注册后可按 kind 解析 provider，注销后移除', async () => {
    const registry = new SubscribableRegistryService(createContext())
    const dispose = registry.register(providerOf('creator'))
    expect(registry.kinds()).toEqual(['creator'])
    expect(registry.provider('creator')?.kind).toBe('creator')
    dispose()
    expect(registry.kinds()).toEqual([])
    expect(registry.provider('creator')).toBeUndefined()
  })

  it('重复 kind 注册抛错', () => {
    const registry = new SubscribableRegistryService(createContext())
    registry.register(providerOf('series'))
    expect(() => registry.register(providerOf('series'))).toThrow('重复注册')
  })

  it('非法 kind 抛错', () => {
    const registry = new SubscribableRegistryService(createContext())
    expect(() => registry.register(providerOf('Bad Kind'))).toThrow('非法 Subscribable kind')
  })

  it('kinds 按注册顺序排列', () => {
    const registry = new SubscribableRegistryService(createContext())
    registry.register(providerOf('tag'))
    registry.register(providerOf('series'))
    registry.register(providerOf('creator'))
    expect(registry.kinds()).toEqual(['tag', 'series', 'creator'])
  })
})