import { describe, expect, it } from 'vitest'

import { splitTabRoutes } from '../lib/tab-routes'

describe('splitTabRoutes', () => {
  it('按固定顺序拆出 tab，其余确定性排序为 push', () => {
    const result = splitTabRoutes([
      'my-plugin/read-later',
      'core/mine',
      'core/search',
      'core/home',
    ])
    expect(result.tabKeys).toEqual(['core/home', 'core/mine'])
    expect(result.pushKeys).toEqual(['core/search', 'my-plugin/read-later'])
  })

  it('tab 全缺失时槽位为空、push 承接全部', () => {
    expect(splitTabRoutes(['core/search'])).toEqual({
      tabKeys: [],
      pushKeys: ['core/search'],
    })
  })
})
