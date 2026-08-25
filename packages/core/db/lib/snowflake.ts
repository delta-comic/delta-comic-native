/**
 * 雪花 ID：64 位自定义布局（时间戳 | 实体类型/分片 | 序列号）。
 *
 * 总宽 63 位保持符号安全；SQLite 以 TEXT 十进制字符串存储，
 * 规避 JS Number 的 64 位精度问题。序列溢出向未来借位，不阻塞调用方。
 */
export const SNOWFLAKE_TIMESTAMP_BITS = 41n
export const SNOWFLAKE_TYPE_BITS = 10n
export const SNOWFLAKE_SEQUENCE_BITS = 12n

const SEQUENCE_MASK = (1n << SNOWFLAKE_SEQUENCE_BITS) - 1n
const TYPE_SHIFT = SNOWFLAKE_SEQUENCE_BITS
const TIMESTAMP_SHIFT = SNOWFLAKE_SEQUENCE_BITS + SNOWFLAKE_TYPE_BITS

export interface ParsedSnowflake {
  readonly timestampMs: bigint
  readonly entityType: bigint
  readonly sequence: bigint
}

export interface SnowflakeOptions {
  /** 自定义纪元毫秒；ID 时间戳 = 墙钟 - epochMs。 */
  readonly epochMs: number
}

export class SnowflakeGenerator {
  readonly #epochMs: bigint
  readonly #now: () => number
  #lastTimestamp = -1n
  #sequence = 0n

  constructor(options: SnowflakeOptions, now: () => number = Date.now) {
    this.#epochMs = BigInt(options.epochMs)
    this.#now = now
  }

  /** 生成下一个 ID，返回十进制字符串。 */
  next(entityType = 0): string {
    if (entityType < 0 || entityType >= 1 << Number(SNOWFLAKE_TYPE_BITS)) {
      throw new RangeError(`实体类型超出 ${SNOWFLAKE_TYPE_BITS} 位范围：${entityType}`)
    }
    let timestamp = BigInt(this.#now()) - this.#epochMs
    if (timestamp < this.#lastTimestamp) timestamp = this.#lastTimestamp
    if (timestamp === this.#lastTimestamp) {
      this.#sequence = (this.#sequence + 1n) & SEQUENCE_MASK
      if (this.#sequence === 0n) timestamp += 1n
    } else {
      this.#sequence = 0n
    }
    this.#lastTimestamp = timestamp
    const id =
      (timestamp << TIMESTAMP_SHIFT) | (BigInt(entityType) << TYPE_SHIFT) | this.#sequence
    return id.toString(10)
  }
}

/** 分解 ID 位段（十进制字符串输入）。 */
export function parseSnowflake(id: string): ParsedSnowflake {
  const value = BigInt(id)
  if (value < 0n || value >> TIMESTAMP_SHIFT >> SNOWFLAKE_TIMESTAMP_BITS !== 0n) {
    throw new RangeError(`不是合法雪花 ID：${id}`)
  }
  return {
    timestampMs: value >> TIMESTAMP_SHIFT,
    entityType: (value >> TYPE_SHIFT) & ((1n << SNOWFLAKE_TYPE_BITS) - 1n),
    sequence: value & SEQUENCE_MASK,
  }
}
