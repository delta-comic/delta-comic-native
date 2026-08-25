/**
 * Store：统一事务边界与行编解码。
 *
 * - 跨 Repository 写操作在同一事务内收集 change，commit 成功后整批发布 ChangeBus
 * - bigint 列以 TEXT 十进制存储（规避 JS 64 位精度问题），布尔列以 INTEGER 0/1 存储
 */
import { type Kysely } from 'kysely'
import { type TSchema } from 'typebox'
import { Value } from 'typebox/value'

import { ChangeBus, type DatabaseTables, type TableChange } from './change'

export class TransactionScope<TDb> {
  constructor(
    readonly db: Kysely<TDb>,
    private readonly pending: TableChange[],
  ) {}

  /** Repository 写操作在事务内登记变更。 */
  record<K extends keyof DatabaseTables>(table: K, kind: TableChange['kind'], id: string): void {
    this.pending.push({ table, kind, id })
  }
}

export class Store<TDb> {
  readonly #db: Kysely<TDb>
  readonly #bus = new ChangeBus()

  constructor(db: Kysely<TDb>) {
    this.#db = db
  }

  get db(): Kysely<TDb> {
    return this.#db
  }

  get changes(): ChangeBus {
    return this.#bus
  }

  /** 统一事务：work 内经 scope.db 读写并登记变更；提交后整批广播。 */
  async transaction<R>(work: (scope: TransactionScope<TDb>) => Promise<R>): Promise<R> {
    return this.#db.transaction().execute(async trx => {
      const pending: TableChange[] = []
      const result = await work(new TransactionScope(trx, pending))
      this.#bus.publish(pending)
      return result
    })
  }
}

export type StorageValue = string | number | bigint | null

/** 列存储类型映射：bigint -> TEXT 十进制字符串，boolean -> 0/1 整数。 */
export type Stored<T> = T extends bigint ? string : T extends boolean ? number : T

export interface RowCodec<Row extends object> {
  /** 行 -> 存储行：bigint 转 TEXT 十进制，boolean 转 0/1。 */
  toStorage(row: Row): { [K in keyof Row]: Stored<Row[K]> }
  /** 存储行 -> 行：还原 bigint/boolean 并做 Value.Check 校验。 */
  fromStorage(row: Record<string, unknown>): Row
}

/**
 * 显式点名转换列：schema 做运行时校验源，
 * bigint/boolean 列名单由表定义方给出，不做隐式推断。
 */
export function rowCodec<Row extends object>(
  schema: TSchema,
  options: {
    readonly bigint?: ReadonlyArray<keyof Row & string>
    readonly boolean?: ReadonlyArray<keyof Row & string>
  } = {},
): RowCodec<Row> {
  const encoders = new Map<string, (value: unknown) => StorageValue>()
  for (const name of options.bigint ?? []) {
    encoders.set(name, value =>
      typeof value === 'bigint' ? value.toString(10) : (value as StorageValue),
    )
  }
  for (const name of options.boolean ?? []) {
    encoders.set(name, value =>
      typeof value === 'boolean' ? (value ? 1 : 0) : (value as StorageValue),
    )
  }
  const decoders = new Map<string, (value: unknown) => unknown>()
  for (const name of options.bigint ?? []) {
    decoders.set(name, value => (typeof value === 'string' ? BigInt(value) : value))
  }
  for (const name of options.boolean ?? []) {
    decoders.set(name, value => (typeof value === 'number' ? value !== 0 : value))
  }

  return {
    toStorage(row: Row): { [K in keyof Row]: Stored<Row[K]> } {
      const out: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(row)) {
        const encode = encoders.get(name)
        out[name] = encode === undefined ? (value as StorageValue) : encode(value)
      }
      // 编码名单由调用方显式给出，此处是存在类型还原边界。
      return out as { [K in keyof Row]: Stored<Row[K]> }
    },
    fromStorage(row: Record<string, unknown>): Row {
      const out: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(row)) {
        const decode = decoders.get(name)
        out[name] = decode === undefined ? value : decode(value)
      }
      if (!Value.Check(schema, out)) throw new TypeError('行校验失败')
      return out as Row
    },
  }
}