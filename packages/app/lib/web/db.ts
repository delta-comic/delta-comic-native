import type { LoaderDatabase } from '@delta-comic/loader'
/**
 * Web 端数据库：sql.js（Wasm SQLite）上的 Kysely 方言。
 * 与 @delta-comic/db 的 node 驱动同形（多语句 exec / 单语句 prepare 绑定）；
 * 首期为内存库（页面生命周期持久），OPFS Worker 化留待平台层接入。
 */
import {
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type QueryResult,
} from 'kysely'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

/** Kysely 参数为 unknown，绑定前收窄到 sql.js 接受的形态。 */
function toSqlParams(values: readonly unknown[]): (string | number | null | Uint8Array)[] {
  return values.map(value => {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'string' || typeof value === 'number' || value === null) return value
    if (value instanceof Uint8Array) return value
    throw new TypeError(`sql.js 不支持的绑定参数类型：${typeof value}`)
  })
}

const ROW_RETURNING_PREFIXES = ['SELECT', 'WITH', 'PRAGMA', 'VALUES'] as const

function returnsRows(compiled: CompiledQuery): boolean {
  const head = compiled.sql.trimStart().slice(0, 12).toUpperCase()
  return ROW_RETURNING_PREFIXES.some(prefix => head.startsWith(prefix))
}

export class SqlJsDriver implements Driver {
  readonly #db: Database

  constructor(db: Database) {
    this.#db = db
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const executeQuery = async <R>(compiled: CompiledQuery): Promise<QueryResult<R>> => {
      const parameters = toSqlParams(compiled.parameters)
      if (parameters.length === 0 && /;.+/s.test(compiled.sql.replace(/'[^\n]*'/g, "''"))) {
        this.#db.exec(compiled.sql)
        return { rows: [] }
      }
      if (returnsRows(compiled)) {
        // 存在类型还原点：行形状由查询方的 Database 泛型声明，
        // 与 @delta-comic/db node 驱动一致，此处是运行时还原边界。
        const rows = collectAll(this.#db, compiled.sql, parameters) as R[]
        return { rows }
      }
      this.#db.run(compiled.sql, parameters)
      return { rows: [], numAffectedRows: BigInt(this.#db.getRowsModified()) }
    }

    return {
      executeQuery,
      /* sql.js 无游标流；以单块全量结果满足接口 */
      streamQuery: async function* streamed<R>(
        this: void,
        compiled: CompiledQuery,
      ): AsyncIterableIterator<QueryResult<R>> {
        yield executeQuery<R>(compiled)
      },
    }
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
    this.#db.close()
  }
}

/** prepare + step 收集全部行（getAsObject 已是普通对象）。 */
function collectAll(
  database: Database,
  sql: string,
  parameters: (string | number | null | Uint8Array)[],
): Record<string, unknown>[] {
  const statement = database.prepare(sql)
  try {
    statement.bind(parameters)
    const rows: Record<string, unknown>[] = []
    while (statement.step()) rows.push(statement.getAsObject())
    return rows
  } finally {
    statement.free()
  }
}

export function sqlJsDialect(db: Database): Dialect {
  return {
    createAdapter: () => new SqliteAdapter(),
    createDriver: () => new SqlJsDriver(db),
    createIntrospector: introspectorDb => new SqliteIntrospector(introspectorDb),
    createQueryCompiler: () => new SqliteQueryCompiler(),
  }
}

/** 打开 Web 宿主库（首期内存形态）。 */
export async function createWebDb(): Promise<Kysely<LoaderDatabase>> {
  const SQL = await initSqlJs({ locateFile: file => wasmUrl.replace(/[^/]*$/, file) })
  return new Kysely<LoaderDatabase>({ dialect: sqlJsDialect(new SQL.Database()) })
}