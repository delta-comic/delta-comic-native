/**
 * 路由注册表与导航服务。
 *
 * - RouteRegistryService：类型化路由表，screen 经 register<K> 静态绑定路由参数
 * - NavigationService：包装导航容器命令面的唯一导航入口，未注册 key 运行期 fail loud
 * - 两者均为 Service Definition：注册即 effect，ctx.routeRegistry/ctx.navigation 注入
 */
import { Service, type Context, type Disposable } from 'cordis'
import type { ReactNode } from 'react'
import { valid } from 'semver'

import { buildRouteKey, isRouteKey, type RouteKey, type Routes } from './keys'

/** 屏幕组件契约：接收与 Routes 声明一致的参数（仅类型层依赖 react）。 */
export interface RouteScreenProps<P> {
  readonly params: P
}

export type RouteScreen<K extends keyof Routes = keyof Routes> = (
  props: RouteScreenProps<Routes[K]>,
) => ReactNode

export interface RouteRegistration<K extends keyof Routes = keyof Routes> {
  /** 来源插件 ID，构成 key 的前缀段。 */
  readonly id: string
  /** 条目自身版本（semver）。 */
  readonly version: string
  /** 路由名（不含插件前缀），必须在 Routes 中声明。 */
  readonly routeName: K
  readonly screen: RouteScreen<K>
}

interface RouteDefinition {
  readonly version: string
  readonly screen: RouteScreen<never>
}

export class RouteRegistryService extends Service {
  private readonly definitions = new Map<RouteKey, RouteDefinition>()

  constructor(ctx: Context) {
    super(ctx, 'routeRegistry')
  }

  /** 注册一个路由；同 key 重复注册抛错。返回注销 disposer。 */
  register<K extends keyof Routes>(registration: RouteRegistration<K>): Disposable {
    if (!valid(registration.version)) {
      throw new TypeError(`注册版本不是合法 semver：${registration.version}`)
    }
    const key = buildRouteKey(registration.id, registration.routeName)
    if (this.definitions.has(key)) {
      throw new Error(`路由注册重复：${key}`)
    }
    this.definitions.set(key, {
      version: registration.version,
      // 异构容器的存在类型边界：screen 与 routeName 的匹配关系由本签名静态保证，
      // 存储层擦除 K 后由 resolveScreen 在编译期还原。
      screen: registration.screen as RouteScreen<never>,
    })
    return () => {
      this.definitions.delete(key)
    }
  }

  has(key: string): boolean {
    return isRouteKey(key) && this.definitions.has(key as RouteKey)
  }

  /** 已注册的全部路由 key，确定性排序。 */
  keys(): RouteKey[] {
    return [...this.definitions.keys()].sort()
  }

  /**
   * 类型擦除还原点：按 key 取回屏幕组件。
   * 已知目标请配合 RouteTarget 使用以获得编译期校验；
   * 遍历 keys() 动态取回时参数类型为全路由联合。
   */
  resolveScreen(key: string): RouteScreen | undefined {
    if (!isRouteKey(key)) return undefined
    return this.definitions.get(key as RouteKey)?.screen as RouteScreen | undefined
  }
}

/** 导航容器命令面最小结构（react-navigation 类型不进 core，结构兼容即可）。 */
export interface NavigationCommands {
  readonly navigate: (name: string, params?: object) => void
  readonly goBack: () => void
  readonly canGoBack: () => boolean
}

export interface NavigateEvent<K extends keyof Routes = keyof Routes> {
  readonly key: `${string}/${K}`
  readonly params: Routes[K]
}

export class NavigationService extends Service {
  private commands: NavigationCommands | undefined

  constructor(ctx: Context) {
    super(ctx, 'navigation')
  }

  /** 绑定导航容器命令面；重复绑定抛错。返回解绑 disposer。 */
  attach(commands: NavigationCommands): Disposable {
    if (this.commands !== undefined) throw new Error('导航容器已绑定')
    this.commands = commands
    return () => {
      if (this.commands === commands) this.commands = undefined
    }
  }

  /**
   * 导航到已注册路由；key 未注册或容器未绑定时抛错。
   * name 段经 Routes 约束获得编译期校验，运行期再经注册表确认。
   */
  navigate<K extends keyof Routes>(key: `${string}/${K}`, params: Routes[K]): void {
    if (!this.ctx.routeRegistry.has(key)) throw new Error(`路由未注册：${key}`)
    if (this.commands === undefined) throw new Error('导航容器未绑定')
    this.commands.navigate(key, params)
    this.ctx.emit('navigation/navigate', { key, params })
  }

  goBack(): void {
    if (this.commands === undefined) throw new Error('导航容器未绑定')
    this.commands.goBack()
  }

  canGoBack(): boolean {
    return this.commands?.canGoBack() ?? false
  }
}

declare module 'cordis' {
  interface Events {
    /** 导航命令成功下发后广播。 @mode emit */
    'navigation/navigate'(event: NavigateEvent): void
  }
  interface Context {
    routeRegistry: RouteRegistryService
    navigation: NavigationService
  }
}
