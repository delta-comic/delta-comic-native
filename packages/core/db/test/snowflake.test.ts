import { describe, expect, it } from 'vitest'

import { SnowflakeGenerator, parseSnowflake } from '../lib/snowflake'

function fixedClock(startMs: number): () => number {
  let current = startMs
  return () => current
}

describe('雪花 ID', () => {
  it('位段可解析且同毫秒单调递增', () => {
    const generator = new SnowflakeGenerator({ epochMs: 0 }, fixedClock(1_000))
    const first = generator.next(7)
    const second = generator.next(7)
    expect(typeof first).toBe('string')
    expect(BigInt(second) > BigInt(first)).toBe(true)

    const parsedFirst = parseSnowflake(first)
    expect(parsedFirst.timestampMs).toBe(1_000n)
    expect(parsedFirst.entityType).toBe(7n)
    expect(parsedFirst.sequence).toBe(0n)
    expect(parseSnowflake(second).sequence).toBe(1n)
  })

  it('序列溢出向未来借位，不阻塞', () => {
    const generator = new SnowflakeGenerator({ epochMs: 0 }, fixedClock(2_000))
    for (let i = 0; i < 4_096; i += 1) generator.next()
    const overflowed = generator.next()
    expect(parseSnowflake(overflowed)).toMatchObject({ timestampMs: 2_001n, sequence: 0n })
  })

  it('时钟回拨时沿用最后时间戳保持单调', () => {
    let current = 3_000
    const generator = new SnowflakeGenerator({ epochMs: 0 }, () => current)
    const before = generator.next()
    current = 2_900
    const after = generator.next()
    expect(BigInt(after) > BigInt(before)).toBe(true)
  })

  it('实体类型超范围抛错', () => {
    const generator = new SnowflakeGenerator({ epochMs: 0 }, fixedClock(0))
    expect(() => generator.next(1 << 10)).toThrow(RangeError)
  })

  it('非法 ID 拒绝解析', () => {
    expect(() => parseSnowflake('-5')).toThrow(RangeError)
  })
})