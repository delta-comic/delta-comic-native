import { Context } from 'cordis'
import { describe, expect, it } from 'vitest'

import { UIRegistryService } from '../lib/index'

declare module '@delta-comic/protocol' {
  interface UIRegistry {
    'ui/button': () => string
    'ui/banner': () => string
  }
}

function createService() {
  return new UIRegistryService(new Context())
}

describe('UIRegistryService', () => {
  it('注册后按类型取回组件', () => {
    const service = createService()
    const Button = () => 'button'
    service.register('ui/button', { id: 'core', version: '1.0.0', component: Button })
    expect(service.get('ui/button')).toBe(Button)
  })

  it('未注册 key 抛错', () => {
    const service = createService()
    expect(() => service.get('ui/banner')).toThrow('UI 注册项不存在')
  })

  it('同 key 下重复 ID 抛错', () => {
    const service = createService()
    const registration = { id: 'core', version: '1.0.0', component: () => 'x' }
    service.register('ui/button', registration)
    expect(() => service.register('ui/button', registration)).toThrow('重复')
  })

  it('非法分层 key 被运行时拒绝（保护 JS 调用方）', () => {
    const service = createService()
    const register = service.register.bind(service)
    expect(() =>
      Reflect.apply(register, null, [
        'button',
        { id: 'core', version: '1.0.0', component: () => '' },
      ]),
    ).toThrow(TypeError)
  })

  it('注册版本必须为合法 semver', () => {
    const service = createService()
    expect(() =>
      service.register('ui/button', { id: 'core', version: 'one', component: () => 'x' }),
    ).toThrow(TypeError)
  })

  it('override 目标不存在抛错', () => {
    const service = createService()
    expect(() =>
      service.register('ui/button', {
        id: 'skin',
        version: '2.0.0',
        priority: 1,
        component: () => 'b',
        override: { targetId: 'base', compatibleVersion: '^1.0.0' },
      }),
    ).toThrow('目标不存在')
  })

  it('override 兼容范围不满足抛错', () => {
    const service = createService()
    service.register('ui/button', { id: 'base', version: '1.0.0', component: () => 'a' })
    expect(() =>
      service.register('ui/button', {
        id: 'skin',
        version: '2.0.0',
        priority: 1,
        component: () => 'b',
        override: { targetId: 'base', compatibleVersion: '^2.0.0' },
      }),
    ).toThrow('兼容范围不满足')
  })

  it('override 优先级不高于目标抛错', () => {
    const service = createService()
    service.register('ui/button', { id: 'base', version: '1.0.0', component: () => 'a' })
    expect(() =>
      service.register('ui/button', {
        id: 'skin',
        version: '2.0.0',
        component: () => 'b',
        override: { targetId: 'base', compatibleVersion: '^1.0.0' },
      }),
    ).toThrow('优先级')
  })

  it('override 生效，注销后回落到目标', () => {
    const service = createService()
    const Base = () => 'base'
    const Skin = () => 'skin'
    service.register('ui/button', { id: 'base', version: '1.0.0', component: Base })
    const dispose = service.register('ui/button', {
      id: 'skin',
      version: '2.0.0',
      priority: 3,
      component: Skin,
      override: { targetId: 'base', compatibleVersion: '^1.0.0' },
    })
    expect(service.get('ui/button')).toBe(Skin)
    dispose()
    expect(service.get('ui/button')).toBe(Base)
  })

  it('经 ctx.plugin 注册后可从 ctx.uiRegistry 读取', async () => {
    const ctx = new Context()
    await ctx.plugin(UIRegistryService)
    ctx.uiRegistry.register('ui/banner', { id: 'core', version: '1.0.0', component: () => 'hi' })
    expect(ctx.uiRegistry.get('ui/banner')()).toBe('hi')
  })
})
describe('UIRegistryService.entries', () => {
  it('投影全部分层 key 与条目元数据，注销后同步消失', () => {
    const service = createService()
    service.register('ui/button', { id: 'core', version: '1.0.0', component: () => 'a' })
    const disposable = service.register('ui/banner', {
      id: 'ext',
      version: '2.1.0',
      priority: 5,
      component: () => 'b',
    })
    expect(service.entries()).toEqual([
      {
        key: 'ui/button',
        items: [{ id: 'core', version: '1.0.0', priority: 0 }],
      },
      {
        key: 'ui/banner',
        items: [{ id: 'ext', version: '2.1.0', priority: 5 }],
      },
    ])

    disposable()
    expect(service.entries().map(entry => entry.key)).toEqual(['ui/button'])
  })

  it('空注册表返回空数组', () => {
    expect(createService().entries()).toEqual([])
  })
})
