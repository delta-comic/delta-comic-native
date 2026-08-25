/**
 * 核心表 DSL 与核心 migration。
 *
 * plugin_state 持久化插件跨重启状态（disabled/unavailable/人工恢复态），
 * 供 loader 启动跳过与恢复界面读取；由表 DSL 编译出 up/down SQL。
 */
import { defineTable, text, textNotNull, type DatabaseOf, type TableRow } from './dsl'
import { snapshotOf } from './snapshot'
import { compileMigration } from './sql'
import type { MigrationEntry } from './migrator'

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

export const coreTables = [pluginStateTable] as const

export type CoreDatabase = DatabaseOf<typeof coreTables>

export type PluginStateRow = TableRow<(typeof pluginStateTable)['columns']>

export const CORE_MIGRATION_NAME = 'core-tables-v1'

const compiled = compileMigration(null, snapshotOf(coreTables))

const joinStatements = (statements: readonly string[]): string =>
  statements.length === 0 ? '' : statements.join(';\n') + ';'

export const coreMigrations: readonly MigrationEntry[] = [
  {
    pluginId: 'core',
    n: 1,
    name: CORE_MIGRATION_NAME,
    up: joinStatements(compiled.up),
    down: joinStatements(compiled.down),
  },
]
