import { describe, expect, it } from 'vitest'

import { formatDeepLink, parseDeepLink } from '../lib/deeplink'
import { buildRouteKey, isRouteKey } from '../lib/keys'

const key = () => buildRouteKey('my-plugin', 'read-later')

describe('路由 key', () => {
  it('合法 kebab 两段通过校验', () => {
    expect(isRouteKey('core/search')).toBe(true)
    expect(isRouteKey('my-plugin/read-later')).toBe(true)
  })

  it('缺段、多段、非法字符被拒绝', () => {
    expect(isRouteKey('search')).toBe(false)
    expect(isRouteKey('core/search/extra')).toBe(false)
    expect(isRouteKey('Core/search')).toBe(false)
    expect(isRouteKey('core/search!')).toBe(false)
    expect(isRouteKey('/search')).toBe(false)
    expect(isRouteKey('core/')).toBe(false)
  })

  it('buildRouteKey 拒绝非法段并保留合法往返', () => {
    expect(() => buildRouteKey('Core', 'search')).toThrow(TypeError)
    const parsed = { pluginId: 'my-plugin', routeName: 'read-later' }
    expect(buildRouteKey(parsed.pluginId, parsed.routeName)).toBe('my-plugin/read-later')
  })
})

describe('parseDeepLink', () => {
  it('解析 scheme、key 与查询参数', () => {
    const target = parseDeepLink('delta-comic://my-plugin/read-later?page=3&order=desc')
    expect(target?.key).toBe('my-plugin/read-later')
    expect(target?.params).toEqual({ page: '3', order: 'desc' })
  })

  it('无查询参数时 params 为空对象', () => {
    expect(parseDeepLink('delta-comic://core/search')?.params).toEqual({})
  })

  it('非本 scheme 与非法 key 返回 null', () => {
    expect(parseDeepLink('https://example.com/core/search')).toBeNull()
    expect(parseDeepLink('delta-comic://not-a-key')).toBeNull()
    expect(parseDeepLink('delta-comic://Core/search')).toBeNull()
  })

  it('解码与空值参数', () => {
    const target = parseDeepLink('delta-comic://core/search?q=%E6%B5%B7%E8%B4%BC&flag')
    expect(target?.params).toEqual({ q: '海贼', flag: '' })
  })
})

describe('formatDeepLink', () => {
  it('与 parseDeepLink 双向往返', () => {
    const target = { key: key(), params: { page: '3', tag: '海' } }
    expect(parseDeepLink(formatDeepLink(target))).toEqual(target)
  })

  it('空 params 不追加问号', () => {
    expect(formatDeepLink({ key: key(), params: {} })).toBe('delta-comic://my-plugin/read-later')
  })
})