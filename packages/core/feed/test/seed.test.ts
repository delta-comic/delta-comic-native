import { describe, expect, it } from 'vitest'

import { compareRank, itemRank, newSessionSeed } from '../lib/seed'

describe('newSessionSeed', () => {
  it('注入随机源后输出确定', () => {
    let calls = 0
    const seed = newSessionSeed(1_000_000, () => {
      const values = [0.1, 0.5, 0.9]
      return values[calls++ % values.length]
    })
    expect(seed).toMatch(/^[a-z0-9]+[a-z0-9]{8}$/)
  })

  it('不同时间基数产出不同 seed', () => {
    expect(newSessionSeed(1, () => 0)).not.toBe(newSessionSeed(2, () => 0))
  })
})

describe('itemRank', () => {
  it('同参数结果稳定（确定性）', () => {
    const first = itemRank('seed-a', 'provider-1', 'item-1')
    expect(itemRank('seed-a', 'provider-1', 'item-1')).toBe(first)
  })

  it('不同 seed/来源/item 产生不同分值', () => {
    const ranks = new Set<number>()
    for (let s = 0; s < 4; s += 1) {
      for (let p = 0; p < 3; p += 1) {
        for (let i = 0; i < 3; i += 1) {
          ranks.add(itemRank(`seed-${s}`, `p-${p}`, `item-${i}`))
        }
      }
    }
    // 碰撞概率极低，36 个组合应几乎全不同
    expect(ranks.size).toBeGreaterThan(30)
  })
})

describe('compareRank', () => {
  const rank = itemRank('seed', 'p', 'x')
  it('分值降序', () => {
    expect(
      compareRank(
        { providerKey: 'a', itemId: 'i', rank: 2 },
        { providerKey: 'b', itemId: 'j', rank: 1 },
      ),
    ).toBe(-1)
    expect(
      compareRank(
        { providerKey: 'a', itemId: 'i', rank: 1 },
        { providerKey: 'b', itemId: 'j', rank: 2 },
      ),
    ).toBe(1)
  })
  it('同分按 providerKey/itemId 字典序', () => {
    expect(
      compareRank({ providerKey: 'a', itemId: 'i', rank }, { providerKey: 'b', itemId: 'j', rank }),
    ).toBeLessThan(0)
    expect(
      compareRank({ providerKey: 'p', itemId: 'x', rank }, { providerKey: 'p', itemId: 'x', rank }),
    ).toBe(0)
  })
})