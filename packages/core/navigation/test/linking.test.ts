import { describe, expect, it } from 'vitest'

import { buildRouteKey } from '../lib/keys'
import { buildLinkingConfig } from '../lib/linking'

describe('buildLinkingConfig', () => {
  it('生成 pattern 与 screen 同名的 flat screens 映射', () => {
    const config = buildLinkingConfig({
      prefixes: ['delta-comic://'],
      routes: [buildRouteKey('core', 'search'), buildRouteKey('my-plugin', 'read-later')],
    })
    expect(config.prefixes).toEqual(['delta-comic://'])
    expect(config.config.screens).toEqual({
      'core/search': 'core/search',
      'my-plugin/read-later': 'my-plugin/read-later',
    })
  })

  it('tab 路由嵌套在 tabs 分组下，push 路由保持平铺', () => {
    const config = buildLinkingConfig({
      prefixes: [],
      routes: [buildRouteKey('core', 'home'), buildRouteKey('core', 'search')],
      tabRoutes: [buildRouteKey('core', 'home')],
    })
    expect(config.config.screens).toEqual({
      tabs: { screens: { 'core/home': 'core/home' } },
      'core/search': 'core/search',
    })
  })

  it('空路由集合产出空 screens', () => {
    const config = buildLinkingConfig({ prefixes: [], routes: [] })
    expect(config.config.screens).toEqual({})
  })
})
