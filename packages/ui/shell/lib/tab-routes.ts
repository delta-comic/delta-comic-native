/**
 * tab 根路由约定与路由拆分。
 *
 * - 底部导航四常规槽固定为 core 宿主路由：home/follow/bookshelf/mine
 * - 其余注册路由一律作为栈内 push 页面挂载
 */
import type { RouteKey } from '@delta-comic/navigation'

export const TAB_ROUTE_KEYS = ['core/home', 'core/follow', 'core/bookshelf', 'core/mine'] as const

export type TabRouteKey = (typeof TAB_ROUTE_KEYS)[number]

export interface SplitRoutes {
  /** 与 TAB_ROUTE_KEYS 同序的已注册 tab key。 */
  readonly tabKeys: readonly string[]
  /** 非 tab 的其余注册 key，确定性排序。 */
  readonly pushKeys: readonly string[]
}

/** 按注册表 key 列表拆分 tab 与 push 两类；tab 缺失时对应槽位不渲染。 */
export function splitTabRoutes(keys: Iterable<RouteKey | string>): SplitRoutes {
  const registered = new Set(keys)
  const tabKeys = TAB_ROUTE_KEYS.filter(key => registered.has(key))
  const tabSet = new Set<string>(tabKeys)
  const pushKeys = [...registered].filter(key => !tabSet.has(key)).sort()
  return { tabKeys, pushKeys }
}
