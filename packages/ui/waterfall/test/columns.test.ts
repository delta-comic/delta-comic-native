import { describe, expect, it } from 'vitest'

import { columnsForWidth } from '../lib/columns'

describe('columnsForWidth', () => {
  it('窄屏返回 2 列', () => {
    expect(columnsForWidth(0)).toBe(2)
    expect(columnsForWidth(375)).toBe(2)
    expect(columnsForWidth(767)).toBe(2)
  })

  it('中屏返回 3 列', () => {
    expect(columnsForWidth(768)).toBe(3)
    expect(columnsForWidth(1024)).toBe(3)
    expect(columnsForWidth(1279)).toBe(3)
  })

  it('宽屏返回 4 列', () => {
    expect(columnsForWidth(1280)).toBe(4)
    expect(columnsForWidth(1920)).toBe(4)
  })
})