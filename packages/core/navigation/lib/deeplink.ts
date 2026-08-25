/**
 * 深链 delta-comic:// 与路由 key 的双向映射。
 *
 * - 形态：delta-comic://<plugin-id>/<route-name>?k=v&k2=v2
 * - 参数值统一为字符串（深链天然无类型）；导航层负责与 Routes 声明的参数类型对接
 * - 解析全程手写，避免依赖各端实现不一的全局 URL
 */
import { buildRouteKey, isRouteKey, type RouteKey } from './keys'

export const DEEP_LINK_SCHEME = 'delta-comic'

export interface DeepLinkTarget {
  readonly key: RouteKey
  readonly params: Readonly<Record<string, string>>
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator)
  if (index < 0) return [value, undefined]
  return [value.slice(0, index), value.slice(index + separator.length)]
}

export function parseQuery(query: string | undefined): Record<string, string> {
  const params: Record<string, string> = {}
  if (query === undefined || query === '') return params
  for (const pair of query.split('&')) {
    if (pair === '') continue
    const [rawKey, rawValue = ''] = splitOnce(pair, '=')
    const key = decodeURIComponent(rawKey)
    if (key === '') continue
    if (key in params) continue
    params[key] = decodeURIComponent(rawValue)
  }
  return params
}

export function formatQuery(params: Readonly<Record<string, string>>): string {
  const pairs: string[] = []
  for (const key of Object.keys(params)) {
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
  }
  return pairs.join('&')
}

/** 解析深链；scheme 不符或 key 非法返回 null。 */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  const prefix = `${DEEP_LINK_SCHEME}://`
  if (!url.startsWith(prefix)) return null
  const [pathPart, queryPart] = splitOnce(url.slice(prefix.length), '?')
  const [pluginId, routeName] = splitOnce(pathPart, '/')
  if (routeName === undefined || !isRouteKey(pathPart)) return null
  return { key: buildRouteKey(pluginId, routeName), params: parseQuery(queryPart) }
}

/** 将路由 key 与参数序列化为深链。 */
export function formatDeepLink(target: DeepLinkTarget): string {
  const path = `${DEEP_LINK_SCHEME}://${target.key}`
  const query = formatQuery(target.params)
  return query === '' ? path : `${path}?${query}`
}
