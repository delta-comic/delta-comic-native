/**
 * 核心表 DSL 与核心 migration。
 *
 * plugin_state 持久化插件跨重启状态（disabled/unavailable/人工恢复态），
 * 供 loader 启动跳过与恢复界面读取；由表 DSL 编译出 up/down SQL。
 *
 * Phase 9 新增资源域两表（migration v2）：
 * - resource：归一化 Resource 描述缓存，(kind, ref) 复合主键
 * - download_task：下载任务持久化，支撑断点续传与重启恢复
 */
import {
  defineTable,
  integer,
  integerNotNull,
  text,
  textNotNull,
  type DatabaseOf,
  type TableRow,
} from './dsl'
import type { MigrationEntry } from './migrator'
import { snapshotOf } from './snapshot'
import { compileMigration } from './sql'

/** 插件持久化状态表；error 为 JSON 序列化的失败详情，无失败时为 null。 */
export const pluginStateTable = defineTable('plugin_state', {
  columns: {
    plugin_id: textNotNull(),
    state: textNotNull(),
    version: textNotNull(),
    error: text(),
    updated_at: textNotNull(),
  },
  primaryKey: ['plugin_id'],
})

/** 资源描述缓存；size_bytes/checksum 列可空对应 descriptor 可选字段。 */
export const resourceTable = defineTable('resource', {
  columns: {
    kind: textNotNull(),
    ref: textNotNull(),
    size_bytes: integer(),
    checksum_algorithm: text(),
    checksum_digest: text(),
    mime: text(),
    updated_at: textNotNull(),
  },
  primaryKey: ['kind', 'ref'],
})

/** 下载任务表；status 为 queued|running|paused|completed|failed|cancelled。 */
export const downloadTaskTable = defineTable('download_task', {
  columns: {
    id: textNotNull(),
    kind: textNotNull(),
    ref: textNotNull(),
    dest_key: textNotNull(),
    status: textNotNull(),
    received_bytes: integerNotNull(),
    total_bytes: integer(),
    error: text(),
    created_at: textNotNull(),
    updated_at: textNotNull(),
  },
  primaryKey: ['id'],
})

export const coreTables = [pluginStateTable, resourceTable, downloadTaskTable] as const

export type CoreDatabase = DatabaseOf<typeof coreTables>

export type PluginStateRow = TableRow<(typeof pluginStateTable)['columns']>

export type ResourceRow = TableRow<(typeof resourceTable)['columns']>

export type DownloadTaskRow = TableRow<(typeof downloadTaskTable)['columns']>

export const CORE_MIGRATION_NAME = 'core-tables-v1'

const joinStatements = (statements: readonly string[]): string =>
  statements.length === 0 ? '' : statements.join(';\n') + ';'

// v1 基座冻结为 plugin_state 单表，保证既有库的已应用迁移文本不变。
const compiledV1 = compileMigration(null, snapshotOf([pluginStateTable]))

const compiledV2 = compileMigration(snapshotOf([pluginStateTable]), snapshotOf(coreTables))

export const coreMigrations: readonly MigrationEntry[] = [
  {
    pluginId: 'core',
    n: 1,
    name: CORE_MIGRATION_NAME,
    up: joinStatements(compiledV1.up),
    down: joinStatements(compiledV1.down),
  },
  {
    pluginId: 'core',
    n: 2,
    name: 'core-resource-v1',
    up: joinStatements(compiledV2.up),
    down: joinStatements(compiledV2.down),
  },
]