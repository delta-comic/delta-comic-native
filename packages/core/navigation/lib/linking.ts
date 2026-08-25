/**
 * React Navigation linking 配置生成（深链与 Web URL 同步的静态部分）。
 *
 * - 每个已注册路由 key 同时作为路径 pattern 与 screen 名：/plugin-id/route-name
 * - 查询参数由 React Navigation 自动映射进路由 params，无需在此展开
 * - tab 根路由需声明嵌套分组（外层容器 screen 名固定 'tabs'），否则无法命中栈内 tab
 */
import type { RouteKey } from './keys'

export interface LinkingConfigInput {
  /** 接受的 URL 前缀，如 'delta-comic://' 与 Web 部署域名。 */
  readonly prefixes: readonly string[]
  /** 已注册路由 key 集合。 */
  readonly routes: Iterable<RouteKey>
  /** 属于底部 tab 容器的路由 key 子集；其路径 pattern 挂在 'tabs' 分组下。 */
  readonly tabRoutes?: Iterable<RouteKey>
}

export interface LinkingConfig {
  readonly prefixes: string[]
  readonly config: {
    readonly screens: Readonly<Record<string, unknown>>
  }
}

/** 由路由 key 集合生成确定性排序的 screens 配置。 */
export function buildLinkingConfig(input: LinkingConfigInput): LinkingConfig {
  const tabPatterns: Record<string, string> = {}
  for (const key of input.tabRoutes ?? []) {
    tabPatterns[key] = key
  }
  const screens: Record<string, unknown> = {}
  if (Object.keys(tabPatterns).length > 0) {
    screens.tabs = { screens: tabPatterns }
  }
  for (const key of input.routes) {
    if (key in tabPatterns) continue
    screens[key] = key
  }
  return { prefixes: [...input.prefixes], config: { screens } }
}
