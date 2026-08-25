/**
 * 调试工具执行器：全部经既有服务公开 API 投影，无旁路。
 */
import { readLedger } from '@delta-comic/db'
import type { LoaderDatabase, PluginLoaderService } from '@delta-comic/loader'
import type { PluginRecord } from '@delta-comic/loader'
import type { NavigationService, RouteRegistryService } from '@delta-comic/navigation'
import { findDebugTool } from '@delta-comic/protocol'
import type { UIRegistryService } from '@delta-comic/registry'
import { sql, type Kysely } from 'kysely'
import { Value } from 'typebox/value'

import type { CaptureFilters } from './capture'

/** 携带稳定错误码的工具失败，bridge 据此构造 response error。 */
export class DebugToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'DebugToolError'
  }
}

export interface DebugDeps {
  readonly appId: string
  readonly platform: string
  readonly appVersion: string
  readonly hostVersion?: string
  readonly db: Kysely<LoaderDatabase>
  readonly loader: PluginLoaderService
  readonly routeRegistry: RouteRegistryService
  readonly uiRegistry: UIRegistryService
  readonly navigation: NavigationService
}

export interface CaptureView {
  tailLogs(limit: number, filters?: CaptureFilters): readonly unknown[]
  searchLogs(query: string, limit: number, filters?: CaptureFilters): readonly unknown[]
  recentEvents(limit: number, namePrefix?: string): readonly unknown[]
}

export type DebugHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

const DEFAULT_LIMIT = 200

function limitOf(params: Record<string, unknown>): number {
  const raw = params.limit
  if (typeof raw !== 'number') return DEFAULT_LIMIT
  return Math.min(Math.max(Math.trunc(raw), 1), 1000)
}

function levelOf(params: Record<string, unknown>): CaptureFilters['level'] {
  return params.level as CaptureFilters['level']
}

function scopeOf(params: Record<string, unknown>): string | undefined {
  return typeof params.scope === 'string' ? params.scope : undefined
}

function assertParams(toolName: string, params: Record<string, unknown>): void {
  const tool = findDebugTool(toolName)
  if (tool === undefined) throw new DebugToolError('TOOL_NOT_FOUND', `未知工具：${toolName}`)
  if (!Value.Check(tool.input, params)) {
    const issue = [...Value.Errors(tool.input, params)][0]
    throw new DebugToolError(
      'INVALID_PARAMS',
      `${toolName} 入参不合法：${issue?.instancePath || '/'} ${issue?.message ?? ''}`,
    )
  }
}

function toWireRecord(record: PluginRecord) {
  return {
    id: record.id,
    version: record.version,
    state: record.state,
    ...(record.failure === undefined ? {} : { failure: record.failure }),
    dependencies: [...record.dependencies],
  }
}

/** 只读 SQL 校验：SELECT/WITH 开头且仅一条语句（允许尾分号）。 */
export function assertReadOnlySql(sqlText: string): string {
  const trimmed = sqlText.trim()
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new DebugToolError('READ_ONLY_REQUIRED', 'db_query 仅接受 SELECT 或 WITH 语句')
  }
  const body = trimmed.replace(/;\s*$/, '').trimEnd()
  if (body.includes(';')) throw new DebugToolError('MULTI_STATEMENT', 'db_query 仅允许单条语句')
  return body
}

export function buildHandlers(deps: DebugDeps, capture: CaptureView): Record<string, DebugHandler> {
  return {
    app_info() {
      return {
        appId: deps.appId,
        platform: deps.platform,
        appVersion: deps.appVersion,
        hostVersion: deps.hostVersion,
        dev: true,
      }
    },
    plugin_list() {
      return { plugins: deps.loader.diagnostics().map(toWireRecord) }
    },
    plugin_detail(params) {
      assertParams('plugin_detail', params)
      const id = String(params.id)
      const record = deps.loader.getRecord(id)
      if (record === undefined) return { found: false }
      return { found: true, record: toWireRecord(record), manifest: deps.loader.manifestOf(id) }
    },
    async db_schema() {
      const result = await deps.db.executeQuery<{ name: unknown; sql: unknown }>(
        sql`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`.compile(
          deps.db,
        ),
      )
      const tables = result.rows ?? []
      const ledger = await readLedger(deps.db)
      return {
        tables: tables.map(row => ({ name: String(row.name), ddl: String(row.sql) })),
        ledger: ledger.map(entry => ({
          id: `${entry.pluginId}/${entry.n}`,
          pluginId: entry.pluginId,
          version: entry.name,
        })),
      }
    },
    async db_query(params) {
      assertParams('db_query', params)
      const sqlText = assertReadOnlySql(String(params.sql))
      const limit = limitOf(params)
      const compiled = sql.raw(sqlText).compile(deps.db)
      const result = await deps.db.executeQuery<{ [column: string]: unknown }>(compiled)
      const rows = result.rows ?? []
      return { rows: rows.slice(0, limit), truncated: rows.length > limit }
    },
    logs_tail(params) {
      return {
        entries: capture.tailLogs(limitOf(params), {
          level: levelOf(params),
          scope: scopeOf(params),
        }),
      }
    },
    logs_search(params) {
      assertParams('logs_search', params)
      return {
        entries: capture.searchLogs(String(params.query), limitOf(params), {
          level: levelOf(params),
          scope: scopeOf(params),
        }),
      }
    },
    events_recent(params) {
      const namePrefix = typeof params.name === 'string' ? params.name : undefined
      return { events: capture.recentEvents(limitOf(params), namePrefix) }
    },
    registry_list() {
      return { routes: [...deps.routeRegistry.keys()], ui: deps.uiRegistry.entries() }
    },
    diagnostics_export() {
      return {
        report: JSON.stringify({
          generatedAt: new Date().toISOString(),
          app: {
            appId: deps.appId,
            platform: deps.platform,
            appVersion: deps.appVersion,
            hostVersion: deps.hostVersion,
          },
          plugins: deps.loader.diagnostics().map(toWireRecord),
          routes: [...deps.routeRegistry.keys()],
          ui: deps.uiRegistry.entries(),
        }),
      }
    },
    async plugin_reload(params) {
      assertParams('plugin_reload', params)
      await deps.loader.reload(String(params.id))
      return {}
    },
    async plugin_enable(params) {
      assertParams('plugin_enable', params)
      await deps.loader.retry(String(params.id))
      return {}
    },
    async plugin_disable(params) {
      assertParams('plugin_disable', params)
      await deps.loader.disable(String(params.id))
      return {}
    },
    async navigate(params) {
      assertParams('navigate', params)
      const key = String(params.key)
      if (!deps.routeRegistry.has(key)) {
        throw new DebugToolError('ROUTE_NOT_FOUND', `路由未注册：${key}`)
      }
      const routeParams = (params.params ?? {}) as object
      // 异构容器的存在类型边界：Routes 的参数匹配无法在动态 key 下静态关联，
      // 注册关系已由 routeRegistry.has 运行时确认，此处是文档化的擦除点。
      const dynamicNavigate = deps.navigation.navigate.bind(deps.navigation) as (
        key: string,
        params: object,
      ) => void
      dynamicNavigate(key, routeParams)
      return {}
    },
  }
}