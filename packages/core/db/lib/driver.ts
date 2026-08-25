/**
 * 四端 SQLite adapter 的参考实现：node:sqlite 同步驱动。
 *
 * 原生端/Web 端（SQLite Wasm + OPFS Worker）在各自平台层提供同形 Dialect；
 * 本驱动同时承担桌面与测试环境。多语句 SQL 走 exec 路径（无参数绑定）。
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite'

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

  constructor(source: DatabaseSync | string) {
    this.#ownsDb = typeof source === 'string'
    this.#db = typeof source === 'string' ? new DatabaseSync(source) : source
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
      const parameters = [...compiled.parameters] as unknown[]
      const multiStatement = /;.+/s.test(compiled.sql.replace(/'[^\n]*'/g, "''"))
      if (multiStatement && parameters.length === 0) {
        this.#db.exec(compiled.sql)
        return { rows: [] }
      }
      const statement = this.#db.prepare(compiled.sql)
      if (returnsRows(compiled)) {
        const rows = toPlainRows(statement.all(...parameters))
        return { rows: rows as R[] }
      }
      const outcome = (statement as StatementSync).run(...parameters)
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

export function nodeSqliteDialect(source: DatabaseSync | string): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new NodeSqliteDriver(source),
    createIntrospector: db => new SqliteIntrospector(db),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  }
}