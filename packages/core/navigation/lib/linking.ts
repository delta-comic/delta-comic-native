/**
 * React Navigation linking 配置生成（Web URL 同步的静态部分）。
 *
 * - 每个已注册路由 key 同时作为路径 pattern 与 screen 名：/plugin-id/route-name
 * - 查询参数由 React Navigation 自动映射进路由 params，无需在此展开
 */
import type { RouteKey } from './keys'

export interface LinkingConfigInput {
  /** 接受的 URL 前缀，如 'delta-comic://' 与 Web 部署域名。 */
  readonly prefixes: readonly string[]
  /** 已注册路由 key 集合。 */
  readonly routes: Iterable<RouteKey>
}

export interface LinkingConfig {
  readonly prefixes: readonly string[]
  readonly config: {
    readonly screens: Readonly<Record<string, string>>
  }
}

/** 由路由 key 集合生成确定性排序的 flat screens 映射。 */
export function buildLinkingConfig(input: LinkingConfigInput): LinkingConfig {
  const screens: Record<string, string> = {}
  for (const key of input.routes) {
    screens[key] = key
  }
  return { prefixes: [...input.prefixes], config: { screens } }
}
