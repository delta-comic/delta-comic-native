/**
 * 四端 SQLite adapter 的参考实现：node:sqlite 同步驱动。
 *
 * 原生端/Web 端（SQLite Wasm + OPFS Worker）在各自平台层提供同形 Dialect；
 * 本驱动同时承担桌面与测试环境。多语句 SQL 走 exec 路径（无参数绑定）。
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'

/**
 * 多语句契约：migration 等批量 SQL 以分号分隔语句（.sql 文件天然如此），
 * 参数为空且含分号时走 exec 路径；单语句保持 prepare 支持绑定参数。
 */

/** Kysely 参数为 unknown，绑定前运行时收窄到 node:sqlite 接受的形态。 */
function toSqlParams(values: readonly unknown[]): SQLInputValue[] {
  return values.map(value => {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      value === null
    ) {
      return value
    }
    if (value instanceof Uint8Array) return value
    throw new TypeError(`不支持的绑定参数类型：${typeof value}`)
  })
}

/** 行结果转为普通对象（node:sqlite 返回 null-prototype 对象）。 */
function toPlainRows(rows: readonly object[]): object[] {
  return rows.map(row => ({ ...row }))
}

const ROW_RETURNING_PREFIXES = ['SELECT', 'WITH', 'PRAGMA', 'VALUES'] as const

function returnsRows(compiled: CompiledQuery): boolean {
  const head = compiled.sql.trimStart().slice(0, 12).toUpperCase()
  return ROW_RETURNING_PREFIXES.some(prefix => head.startsWith(prefix))
}

export class NodeSqliteDriver implements Driver {
  readonly #db: DatabaseSync
  readonly #ownsDb: boolean

  private constructor(db: DatabaseSync, ownsDb: boolean) {
    this.#db = db
    this.#ownsDb = ownsDb
  }

  /** 接管已打开的数据库连接，destroy 时关闭。 */
  static takingOwnership(db: DatabaseSync): NodeSqliteDriver {
    return new NodeSqliteDriver(db, true)
  }

  /** 仅借用外部连接，destroy 保持其打开。 */
  static borrowing(db: DatabaseSync): NodeSqliteDriver {
    return new NodeSqliteDriver(db, false)
  }

  /** 打开路径并接管连接。 */
  static open(path: string): NodeSqliteDriver {
    return NodeSqliteDriver.takingOwnership(new DatabaseSync(path))
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return this.#connection()
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'BEGIN', parameters: [], query: {} } as never)
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'COMMIT', parameters: [], query: {} } as never)
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery({ sql: 'ROLLBACK', parameters: [], query: {} } as never)
  }

  async releaseConnection(): Promise<void> {}

  async destroy(): Promise<void> {
    if (this.#ownsDb) this.#db.close()
  }

  #connection(): DatabaseConnection {
    const executeQuery = async <R>(compiled: CompiledQuery): Promise<QueryResult<R>> => {
      const parameters = toSqlParams(compiled.parameters)
      if (parameters.length === 0 && /;.+/s.test(compiled.sql.replace(/'[^\n]*'/g, "''"))) {
        this.#db.exec(compiled.sql)
        return { rows: [] }
      }
      const statement = this.#db.prepare(compiled.sql)
      if (returnsRows(compiled)) {
        // 行形状由查询方的 Database 泛型声明，此处是运行时还原边界。
        const rows = toPlainRows(statement.all(...parameters)) as R[]
        return { rows }
      }
      const outcome = statement.run(...parameters)
      return { rows: [], numAffectedRows: BigInt(outcome.changes) }
    }

    return {
      executeQuery,
      // node:sqlite 无游标流；以单块全量结果满足接口。
      streamQuery: async function* streamed<R>(
        this: void,
        compiled: CompiledQuery,
      ): AsyncIterableIterator<QueryResult<R>> {
        yield executeQuery<R>(compiled)
      },
    }
  }
}

export function nodeSqliteDialect(path: string): Dialect {
  return dialectOf(NodeSqliteDriver.open(path))
}

export function nodeSqliteDialectFrom(db: DatabaseSync): Dialect {
  return dialectOf(NodeSqliteDriver.borrowing(db))
}

function dialectOf(driver: NodeSqliteDriver): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => driver,
    createIntrospector: db => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  }
}