/**
 * 核心表 DSL 与核心 migration。
 *
 * plugin_state 持久化插件跨重启状态（disabled/unavailable/人工恢复态），
 * 供 loader 启动跳过与恢复界面读取；由表 DSL 编译出 up/down SQL。
 *
 * Phase 9 新增资源域两表（migration v2）：
 * - resource：归一化 Resource 描述缓存，(kind, ref) 复合主键
 * - download_task：下载任务持久化，支撑断点续传与重启恢复
 *
 * Phase 10 新增用户域四表（migration v3，完全本地化，无账户外键）：
 * - subscription_group：关注分组；id 'default' 为系统默认分组
 * - subscription：订阅归属，(target_kind, target_id) 唯一
 * - item_history：打开历史与进度，payload_json 存 Item 快照
 * - shelf_item：书架收藏/稍后条目，(kind, item_id) 唯一
 *
 * Phase 11 新增网络域一表（migration v4）：
 * - plugin_endpoint：EdgeRouter 端点探测状态，冷启动 TTL 内免探复用
 */
import {
  defineTable,
  integer,
  integerNotNull,
  real,
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

/** 关注分组表；id 'default' 为系统默认分组（不可删除，可改名）。 */
export const subscriptionGroupTable = defineTable('subscription_group', {
  columns: {
    id: textNotNull(),
    title: textNotNull(),
    sort_key: integerNotNull(),
    created_at: textNotNull(),
    updated_at: textNotNull(),
  },
  primaryKey: ['id'],
})

/** 订阅表；(target_kind, target_id) 唯一，group_id 单一归属。 */
export const subscriptionTable = defineTable('subscription', {
  columns: {
    id: textNotNull(),
    target_kind: textNotNull(),
    target_id: textNotNull(),
    group_id: textNotNull(),
    sort_key: integerNotNull(),
    created_at: textNotNull(),
    updated_at: textNotNull(),
  },
  primaryKey: ['id'],
  indexes: [{ columns: ['target_kind', 'target_id'], unique: true }],
})

/**
 * 打开历史与进度表；payload_json 存 Item 快照（含 preview/sourceRefs 等），
 * progress_json 为插件自决结构的 JSON 序列化，progress_ratio 为归一化进度 0~1。
 */
export const itemHistoryTable = defineTable('item_history', {
  columns: {
    item_id: textNotNull(),
    title: textNotNull(),
    player_key: textNotNull(),
    payload_json: textNotNull(),
    progress_json: text(),
    progress_ratio: real(),
    opened_count: integerNotNull(),
    first_opened_at: textNotNull(),
    last_opened_at: textNotNull(),
  },
  primaryKey: ['item_id'],
})

/** 书架条目表；kind 为 favorite|later，(kind, item_id) 唯一。 */
export const shelfItemTable = defineTable('shelf_item', {
  columns: {
    id: textNotNull(),
    kind: textNotNull(),
    item_id: textNotNull(),
    title: textNotNull(),
    player_key: textNotNull(),
    payload_json: textNotNull(),
    created_at: textNotNull(),
    updated_at: textNotNull(),
  },
  primaryKey: ['id'],
  indexes: [{ columns: ['kind', 'item_id'], unique: true }],
})

/**
 * 插件端点探测状态表；latency_ms/last_ok_at 可空表示尚未成功过，
 * fail_count 驱动退避重探，label 保留候选展示名。
 */
export const pluginEndpointTable = defineTable('plugin_endpoint', {
  columns: {
    plugin_id: textNotNull(),
    url: textNotNull(),
    label: text(),
    latency_ms: integer(),
    last_ok_at: text(),
    fail_count: integerNotNull(),
    updated_at: textNotNull(),
  },
  primaryKey: ['plugin_id', 'url'],
})

/**
 * 审计日志表；kind 为 deny|invoke|error，detail 为 JSON 序列化的补充信息，
 * id 为写入时生成的单调键（毫秒时间戳 + 序号），按 at 索引支持裁剪与倒序查询。
 */
export const auditLogTable = defineTable('audit_log', {
  columns: {
    id: textNotNull(),
    at: textNotNull(),
    kind: textNotNull(),
    plugin_id: text(),
    capability: text(),
    detail: text(),
  },
  primaryKey: ['id'],
  indexes: [{ columns: ['at'] }],
})

export const coreTables = [
  pluginStateTable,
  resourceTable,
  downloadTaskTable,
  subscriptionGroupTable,
  subscriptionTable,
  itemHistoryTable,
  shelfItemTable,
  pluginEndpointTable,
  auditLogTable,
] as const

export type CoreDatabase = DatabaseOf<typeof coreTables>

export type PluginStateRow = TableRow<(typeof pluginStateTable)['columns']>

export type ResourceRow = TableRow<(typeof resourceTable)['columns']>

export type DownloadTaskRow = TableRow<(typeof downloadTaskTable)['columns']>

export type SubscriptionGroupRow = TableRow<(typeof subscriptionGroupTable)['columns']>

export type SubscriptionRow = TableRow<(typeof subscriptionTable)['columns']>

export type ItemHistoryRow = TableRow<(typeof itemHistoryTable)['columns']>

export type ShelfItemRow = TableRow<(typeof shelfItemTable)['columns']>

export type PluginEndpointRow = TableRow<(typeof pluginEndpointTable)['columns']>

export type AuditLogRow = TableRow<(typeof auditLogTable)['columns']>

export const CORE_MIGRATION_NAME = 'core-tables-v1'

const joinStatements = (statements: readonly string[]): string =>
  statements.length === 0 ? '' : statements.join(';\n') + ';'

// v1 基座冻结为 plugin_state 单表，保证既有库的已应用迁移文本不变。
const compiledV1 = compileMigration(null, snapshotOf([pluginStateTable]))

// 资源域基线冻结为三表，保证既有库的 v2 已应用迁移文本不变。
const resourceEraTables = [pluginStateTable, resourceTable, downloadTaskTable] as const

const compiledV2 = compileMigration(snapshotOf([pluginStateTable]), snapshotOf(resourceEraTables))

// 用户域基线为资源域三表 + 用户域五表；网络域追加 plugin_endpoint。
const userEraTables = coreTables.filter(
  table => table !== pluginEndpointTable && table !== auditLogTable,
)

const compiledV3 = compileMigration(snapshotOf(resourceEraTables), snapshotOf(userEraTables))

// 网络域冻结为用户域 + plugin_endpoint，保证既有库的 v4 已应用迁移文本不变。
const networkEraTables = coreTables.filter(table => table !== auditLogTable)

const compiledV4 = compileMigration(snapshotOf(userEraTables), snapshotOf(networkEraTables))

// 审计域追加 audit_log。
const compiledV5 = compileMigration(snapshotOf(networkEraTables), snapshotOf(coreTables))

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
  {
    pluginId: 'core',
    n: 3,
    name: 'core-user-v1',
    up: joinStatements(compiledV3.up),
    down: joinStatements(compiledV3.down),
  },
  {
    pluginId: 'core',
    n: 4,
    name: 'core-network-v1',
    up: joinStatements(compiledV4.up),
    down: joinStatements(compiledV4.down),
  },
  {
    pluginId: 'core',
    n: 5,
    name: 'core-audit-v1',
    up: joinStatements(compiledV5.up),
    down: joinStatements(compiledV5.down),
  },
]