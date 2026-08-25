/**
 * 路由 key 约定与类型化导航目标。
 *
 * - key 形如 'plugin-id/route-name'，两段均为 kebab-case
 * - 各路由名的参数类型由宿主与插件经 module augmentation 声明到 Routes
 * - RouteTarget 将 name 段约束在已声明路由内，未注册 key 在编译期即报错
 */

/** 路由参数表基线：key 为路由名（不含 pluginId 前缀），value 为参数对象。 */
export interface Routes {}

const ROUTE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/

declare const routeKeyBrand: unique symbol

/** 品牌化路由 key：仅由 buildRouteKey/parseDeepLink 等校验入口产生。 */
export type RouteKey = string & { readonly [routeKeyBrand]: 'RouteKey' }

/** 校验路由 key：'plugin-id/route-name'，两段 kebab-case。 */
export function isRouteKey(value: string): boolean {
  return ROUTE_KEY_PATTERN.test(value)
}

/** 由插件 ID 与路由名构造路由 key；任一段非法即抛错。 */
export function buildRouteKey(pluginId: string, routeName: string): RouteKey {
  const key = `${pluginId}/${routeName}`
  if (!isRouteKey(key)) throw new TypeError(`非法路由 key：${key}`)
  // 校验边界的存在类型还原点：合法性由上一行运行时保证。
  return key as RouteKey
}

export interface ParsedRouteKey {
  readonly pluginId: string
  readonly routeName: string
}

/** 拆分路由 key 为来源插件 ID 与路由名。 */
export function parseRouteKey(key: RouteKey): ParsedRouteKey {
  const index = key.indexOf('/')
  return { pluginId: key.slice(0, index), routeName: key.slice(index + 1) }
}

/**
 * 类型化导航目标：name 段必须已在 Routes 中声明。
 * 例：Routes 声明 search: { query: string } 后，'core/search' 合法而 'core/nope' 编译报错。
 */
export type RouteTarget = {
  readonly [K in keyof Routes & string]: `${string}/${K}`
}[keyof Routes & string]
