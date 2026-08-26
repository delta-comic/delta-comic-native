import { describe, expect, it } from 'vitest'

import { formatViewCount } from '../lib/format'

describe('formatViewCount', () => {
  it('万以下原样展示', () => {
    expect(formatViewCount(0)).toBe('0')
    expect(formatViewCount(42)).toBe('42')
    expect(formatViewCount(9999)).toBe('9999')
  })

  it('万级一位小数并去掉尾零', () => {
    expect(formatViewCount(12_300)).toBe('1.2万')
    expect(formatViewCount(10_000)).toBe('1万')
    expect(formatViewCount(999_999_999)).toBe('10亿')
  })

  it('亿级一位小数', () => {
    expect(formatViewCount(123_456_789)).toBe('1.2亿')
  })

  it('非法输入归零', () => {
    expect(formatViewCount(-5)).toBe('0')
    expect(formatViewCount(Number.NaN)).toBe('0')
  })
})