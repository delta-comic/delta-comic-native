import { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'

import { buildRouteKey } from '../lib/keys'
import { NavigationService, RouteRegistryService, type NavigateEvent } from '../lib/service'

declare module '../lib/keys' {
  interface Routes {
    search: { readonly query: string }
    'read-later': { readonly page: number }
  }
}

async function createServices() {
  const ctx = new Context()
  await ctx.plugin(RouteRegistryService)
  await ctx.plugin(NavigationService)
  return ctx
}

const fakeCommands = () => ({ navigate: vi.fn(), goBack: vi.fn(), canGoBack: vi.fn(() => true) })

describe('RouteRegistryService', () => {
  it('注册后可查询与取回屏幕', async () => {
    const ctx = await createServices()
    const screen = (props: { params: { query: string } }) => props.params.query
    const dispose = ctx.routeRegistry.register({
      id: 'core',
      version: '1.0.0',
      routeName: 'search',
      screen,
    })
    expect(ctx.routeRegistry.has('core/search')).toBe(true)
    expect(ctx.routeRegistry.resolveScreen('core/search')).toBe(screen)
    dispose()
    expect(ctx.routeRegistry.has('core/search')).toBe(false)
  })

  it('同 key 重复注册与非法版本抛错', async () => {
    const ctx = await createServices()
    const registration = {
      id: 'core',
      version: '1.0.0',
      routeName: 'search' as const,
      screen: () => '',
    }
    ctx.routeRegistry.register(registration)
    expect(() => ctx.routeRegistry.register(registration)).toThrow('重复')
    expect(() =>
      ctx.routeRegistry.register({ ...registration, version: 'one' }),
    ).toThrow(TypeError)
  })

  it('keys 确定性排序', async () => {
    const ctx = await createServices()
    for (const id of ['b-plugin', 'a-plugin']) {
      ctx.routeRegistry.register({
        id,
        version: '1.0.0',
        routeName: 'read-later',
        screen: () => '',
      })
    }
    expect(ctx.routeRegistry.keys()).toEqual([
      buildRouteKey('a-plugin', 'read-later'),
      buildRouteKey('b-plugin', 'read-later'),
    ])
  })

  it('has 对非法 key 返回 false 而非抛错', async () => {
    const ctx = await createServices()
    expect(ctx.routeRegistry.has('not-a-key')).toBe(false)
  })
})

describe('NavigationService', () => {
  it('导航前需注册路由并绑定容器，成功后广播事件', async () => {
    const ctx = await createServices()
    ctx.routeRegistry.register({
      id: 'core',
      version: '1.0.0',
      routeName: 'search',
      screen: () => '',
    })
    expect(() => ctx.navigation.navigate('core/search', { query: '海贼' })).toThrow(
      '导航容器未绑定',
    )
    const commands = fakeCommands()
    const unbind = ctx.navigation.attach(commands)
    const listener = vi.fn<(event: NavigateEvent) => void>()
    ctx.on('navigation/navigate', listener)
    ctx.navigation.navigate('core/search', { query: '海贼' })
    expect(commands.navigate).toHaveBeenCalledWith('core/search', { query: '海贼' })
    expect(listener).toHaveBeenCalledWith({ key: 'core/search', params: { query: '海贼' } })
    unbind()
    expect(() => ctx.navigation.navigate('core/search', { query: '' })).toThrow('未绑定')
  })

  it('未注册 key 抛错且不下发命令', async () => {
    const ctx = await createServices()
    const commands = fakeCommands()
    ctx.navigation.attach(commands)
    expect(() => ctx.navigation.navigate('ghost/search', { query: '' })).toThrow(
      '路由未注册：ghost/search',
    )
    expect(commands.navigate).not.toHaveBeenCalled()
  })

  it('JS 调用方传入非法 key 被运行时拒绝', async () => {
    const ctx = await createServices()
    ctx.navigation.attach(fakeCommands())
    const navigate = ctx.navigation.navigate.bind(ctx.navigation)
    expect(() =>
      Reflect.apply(navigate, null, ['garbage', {}]),
    ).toThrow('路由未注册：garbage')
  })

  it('重复绑定抛错；goBack/canGoBack 透传容器状态', async () => {
    const ctx = await createServices()
    const commands = fakeCommands()
    const unbind = ctx.navigation.attach(commands)
    expect(() => ctx.navigation.attach(fakeCommands())).toThrow('已绑定')
    expect(ctx.navigation.canGoBack()).toBe(true)
    ctx.navigation.goBack()
    expect(commands.goBack).toHaveBeenCalled()
    unbind()
    expect(ctx.navigation.canGoBack()).toBe(false)
    expect(() => ctx.navigation.goBack()).toThrow('未绑定')
  })
})
