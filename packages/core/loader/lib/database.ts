/**
 * DatabaseService：宿主持有的 loader 数据库投影。
 *
 * 宿主启动时以 Kysely<LoaderDatabase> 实例构造并注册；调试通道（Dev MCP）
 * 经 inject ['database'] 获得只读查询与 schema 检视能力。
 */
import { Service, type Context } from 'cordis'
import type { Kysely } from 'kysely'

import type { LoaderDatabase } from './service'

export class DatabaseService extends Service {
  readonly db: Kysely<LoaderDatabase>

  constructor(ctx: Context, db: Kysely<LoaderDatabase>) {
    super(ctx, 'database')
    this.db = db
  }
}

declare module 'cordis' {
  interface Context {
    database: DatabaseService
  }
}