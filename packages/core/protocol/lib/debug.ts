/**
 * Dev MCP 调试通道线协议（架构 §13）。
 *
 * 本文件是应用侧（packages/plugins/debug）与工具侧（scripts/dev-mcp）共享的
 * 唯一校验源：WebSocket 信封与 MCP 工具出入参均以这里的 TypeBox schema 为准。
 *
 * - 信封：hello（设备上线宣告）/ request（工具调用）/ response（调用结果）
 * - 工具分观察（observe）与操控（control）两类；control 类在 dev-mcp 侧逐项门控
 * - 生产构建零包含：应用侧仅在 __DEV__ 下挂载本协议实现
 */
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'

const PROTOCOL_VERSION = Type.Literal(1)

export const DebugHelloSchema = Type.Object(
  {
    v: PROTOCOL_VERSION,
    kind: Type.Literal('hello'),
    appId: Type.String({ minLength: 1, description: '应用实例标识，hub 按其寻址' }),
    platform: Type.String({ minLength: 1, description: 'ios/android/web/macos/windows' }),
    appVersion: Type.String({ minLength: 1 }),
    hostVersion: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
)

export const DebugRequestSchema = Type.Object(
  {
    v: PROTOCOL_VERSION,
    kind: Type.Literal('request'),
    id: Type.String({ minLength: 1, description: '请求 id，response 以其回执' }),
    tool: Type.String({ minLength: 1 }),
    params: Type.Unknown({ description: 'tool 对应的入参对象，由工具 schema 校验' }),
  },
  { additionalProperties: false },
)

export const DebugResponseSchema = Type.Union([
  Type.Object({
    v: PROTOCOL_VERSION,
    kind: Type.Literal('response'),
    id: Type.String({ minLength: 1 }),
    ok: Type.Literal(true),
    result: Type.Unknown(),
  }),
  Type.Object({
    v: PROTOCOL_VERSION,
    kind: Type.Literal('response'),
    id: Type.String({ minLength: 1 }),
    ok: Type.Literal(false),
    error: Type.Object(
      {
        code: Type.String({ minLength: 1, description: 'stable 错误码，如 TOOL_NOT_FOUND' }),
        message: Type.String(),
      },
      { additionalProperties: false },
    ),
  }),
])

export const DebugMessageSchema = Type.Union(
  [DebugHelloSchema, DebugRequestSchema, DebugResponseSchema],
  { description: '调试 WebSocket 单帧消息' },
)

export type DebugHello = Static<typeof DebugHelloSchema>
export type DebugRequest = Static<typeof DebugRequestSchema>
export type DebugSuccessResponse = Extract<Static<typeof DebugResponseSchema>, { ok: true }>
export type DebugErrorResponse = Extract<Static<typeof DebugResponseSchema>, { ok: false }>
export type DebugResponse = Static<typeof DebugResponseSchema>
export type DebugMessage = Static<typeof DebugMessageSchema>

export interface DebugIssue {
  readonly path: string
  readonly message: string
}

export type DebugParseResult =
  | { readonly ok: true; readonly message: DebugMessage }
  | { readonly ok: false; readonly issues: readonly DebugIssue[] }

/** 校验单帧消息，返回判别联合结果。 */
export function parseDebugMessage(value: unknown): DebugParseResult {
  if (!Value.Check(DebugMessageSchema, value)) {
    return {
      ok: false,
      issues: [...Value.Errors(DebugMessageSchema, value)].map(error => ({
        path: error.instancePath || '/',
        message: error.message ?? '校验失败',
      })),
    }
  }
  return { ok: true, message: value }
}

export function makeDebugRequest(
  id: string,
  tool: string,
  params: Record<string, unknown>,
): DebugRequest {
  return { v: 1, kind: 'request', id, tool, params }
}

export function makeDebugSuccess(id: string, result: unknown): DebugSuccessResponse {
  return { v: 1, kind: 'response', id, ok: true, result }
}

export function makeDebugError(id: string, code: string, message: string): DebugErrorResponse {
  return { v: 1, kind: 'response', id, ok: false, error: { code, message } }
}

/**
 * 工具定义注册表：name 全局唯一，input/output 为 JSON Schema 形状的 TypeBox schema，
 * 两端共用同一数组保证出入参契约一致。
 */
export interface DebugToolDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly kind: 'observe' | 'control'
  readonly input: TSchema
  readonly output: TSchema
}

const PluginRecordSchema = Type.Object({
  id: Type.String(),
  version: Type.String(),
  state: Type.Union(
    [
      Type.Literal('discovered'),
      Type.Literal('verified'),
      Type.Literal('migrating'),
      Type.Literal('migrated'),
      Type.Literal('activating'),
      Type.Literal('active'),
      Type.Literal('disabled'),
      Type.Literal('unavailable'),
    ],
    { description: '插件生命周期状态（loader 八态）' },
  ),
  failure: Type.Optional(
    Type.Object(
      {
        stage: Type.Union([
          Type.Literal('verify'),
          Type.Literal('migrate'),
          Type.Literal('activate'),
          Type.Literal('rollback'),
        ]),
        message: Type.String(),
      },
      { additionalProperties: false },
    ),
  ),
  dependencies: Type.Array(Type.String()),
})

const LogEntrySchema = Type.Object({
  sn: Type.Integer({ description: '日志序号，单调递增' }),
  ts: Type.Number({ description: '毫秒时间戳' }),
  scope: Type.String({ description: 'logger 名称' }),
  level: Type.Union([
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
  ]),
  args: Type.Array(Type.Unknown(), { description: 'printf 风格参数序列化结果' }),
})

const EventRecordSchema = Type.Object({
  sn: Type.Integer(),
  ts: Type.Number(),
  mode: Type.String({ description: 'dispatch 模式：emit/waterfall/parallel/serial/bail' }),
  name: Type.String(),
  args: Type.Array(Type.Unknown()),
})

const LIMIT_DEFAULT = 200

function LimitSchema(max: number) {
  return Type.Optional(Type.Integer({ minimum: 1, maximum: max, default: LIMIT_DEFAULT }))
}

const LevelFilterSchema = Type.Optional(
  Type.Union([
    Type.Literal('error'),
    Type.Literal('warn'),
    Type.Literal('info'),
    Type.Literal('debug'),
  ]),
)

export const APP_INFO_TOOL: DebugToolDefinition = {
  name: 'app_info',
  title: '应用信息',
  description: '返回当前设备的应用标识、平台、版本与调试模式状态。',
  kind: 'observe',
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object(
    {
      appId: Type.String(),
      platform: Type.String(),
      appVersion: Type.String(),
      hostVersion: Type.Optional(Type.String()),
      dev: Type.Boolean({ description: '是否处于 __DEV__ 调试模式' }),
    },
    { additionalProperties: false },
  ),
}

export const PLUGIN_LIST_TOOL: DebugToolDefinition = {
  name: 'plugin_list',
  title: '插件列表',
  description: '列出全部插件的加载记录：状态、失败阶段与依赖。',
  kind: 'observe',
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object({ plugins: Type.Array(PluginRecordSchema) }, { additionalProperties: false }),
}

export const PLUGIN_DETAIL_TOOL: DebugToolDefinition = {
  name: 'plugin_detail',
  title: '插件详情',
  description: '按 id 返回单个插件的加载记录与 manifest 原文。',
  kind: 'observe',
  input: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  output: Type.Object(
    {
      found: Type.Boolean(),
      record: Type.Optional(PluginRecordSchema),
      manifest: Type.Optional(Type.Unknown({ description: 'manifest 原文（JSON 值）' })),
    },
    { additionalProperties: false },
  ),
}

export const DB_SCHEMA_TOOL: DebugToolDefinition = {
  name: 'db_schema',
  title: '数据库结构',
  description: '读取 SQLite sqlite_master 的表结构与 migration ledger 记录。',
  kind: 'observe',
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object(
    {
      tables: Type.Array(
        Type.Object({ name: Type.String(), ddl: Type.String() }, { additionalProperties: false }),
      ),
      ledger: Type.Array(
        Type.Object(
          {
            id: Type.String({ description: 'pluginId/n' }),
            pluginId: Type.String(),
            version: Type.String({ description: '迁移名' }),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
}

export const DB_QUERY_TOOL: DebugToolDefinition = {
  name: 'db_query',
  title: '只读查询',
  description: '执行单条只读 SQL（SELECT 或 WITH 开头），返回行数据；上限由 limit 控制。',
  kind: 'observe',
  input: Type.Object(
    { sql: Type.String({ minLength: 1 }), limit: LimitSchema(1000) },
    { additionalProperties: false },
  ),
  output: Type.Object(
    {
      rows: Type.Array(Type.Record(Type.String(), Type.Unknown())),
      truncated: Type.Boolean({ description: '结果是否因 limit 截断' }),
    },
    { additionalProperties: false },
  ),
}

export const LOGS_TAIL_TOOL: DebugToolDefinition = {
  name: 'logs_tail',
  title: '日志尾部',
  description: '从环形日志缓冲取最近若干条，可按级别与 logger 名称过滤。',
  kind: 'observe',
  input: Type.Object(
    {
      limit: LimitSchema(1000),
      level: LevelFilterSchema,
      scope: Type.Optional(Type.String({ minLength: 1, description: 'logger 名称前缀过滤' })),
    },
    { additionalProperties: false },
  ),
  output: Type.Object({ entries: Type.Array(LogEntrySchema) }, { additionalProperties: false }),
}

export const LOGS_SEARCH_TOOL: DebugToolDefinition = {
  name: 'logs_search',
  title: '日志搜索',
  description: '在环形日志缓冲内做大小写不敏感子串搜索，可按级别与 logger 名称过滤。',
  kind: 'observe',
  input: Type.Object(
    {
      query: Type.String({ minLength: 1 }),
      limit: LimitSchema(1000),
      level: LevelFilterSchema,
      scope: Type.Optional(Type.String({ minLength: 1 })),
    },
    { additionalProperties: false },
  ),
  output: Type.Object({ entries: Type.Array(LogEntrySchema) }, { additionalProperties: false }),
}

export const EVENTS_RECENT_TOOL: DebugToolDefinition = {
  name: 'events_recent',
  title: '事件回放',
  description: '返回环形事件缓冲中最近的 Cordis 事件派发记录（internal:* 已剔除）。',
  kind: 'observe',
  input: Type.Object(
    {
      limit: LimitSchema(1000),
      name: Type.Optional(Type.String({ minLength: 1, description: '事件名前缀过滤' })),
    },
    { additionalProperties: false },
  ),
  output: Type.Object({ events: Type.Array(EventRecordSchema) }, { additionalProperties: false }),
}

export const REGISTRY_LIST_TOOL: DebugToolDefinition = {
  name: 'registry_list',
  title: '注册表投影',
  description: '返回路由注册表全部 key 与 UI 注册表分层条目。',
  kind: 'observe',
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object(
    {
      routes: Type.Array(Type.String(), { description: '路由 key 列表（plugin-id/route-name）' }),
      ui: Type.Array(
        Type.Object(
          {
            key: Type.String({ description: 'UI 分层 key' }),
            items: Type.Array(
              Type.Object(
                { id: Type.String(), version: Type.String(), priority: Type.Integer() },
                { additionalProperties: false },
              ),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
}

export const DIAGNOSTICS_EXPORT_TOOL: DebugToolDefinition = {
  name: 'diagnostics_export',
  title: '诊断导出',
  description: '聚合 loader 诊断与运行信息为一份 JSON 报告字符串。',
  kind: 'observe',
  input: Type.Object({}, { additionalProperties: false }),
  output: Type.Object({ report: Type.String() }, { additionalProperties: false }),
}

export const PLUGIN_RELOAD_TOOL: DebugToolDefinition = {
  name: 'plugin_reload',
  title: '重载插件',
  description: '卸载并重新激活指定插件；失败时插件进入 disabled 并落盘。',
  kind: 'control',
  input: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  output: Type.Object({}, { additionalProperties: false }),
}

export const PLUGIN_ENABLE_TOOL: DebugToolDefinition = {
  name: 'plugin_enable',
  title: '启用插件',
  description: '对 disabled/unavailable 插件重新走激活流程。',
  kind: 'control',
  input: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  output: Type.Object({}, { additionalProperties: false }),
}

export const PLUGIN_DISABLE_TOOL: DebugToolDefinition = {
  name: 'plugin_disable',
  title: '停用插件',
  description: '卸载插件并标记为 disabled 持久化，重启后保持停用。',
  kind: 'control',
  input: Type.Object({ id: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  output: Type.Object({}, { additionalProperties: false }),
}

export const NAVIGATE_TOOL: DebugToolDefinition = {
  name: 'navigate',
  title: '路由跳转',
  description: '驱动应用导航到指定路由 key（plugin-id/route-name），params 透传给目标路由。',
  kind: 'control',
  input: Type.Object(
    {
      key: Type.String({ minLength: 1, pattern: '^[^/]+/[^/]+' }),
      params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    },
    { additionalProperties: false },
  ),
  output: Type.Object({}, { additionalProperties: false }),
}

/** 全部调试工具，顺序即文档顺序。 */
export const DEBUG_TOOLS: readonly DebugToolDefinition[] = [
  APP_INFO_TOOL,
  PLUGIN_LIST_TOOL,
  PLUGIN_DETAIL_TOOL,
  DB_SCHEMA_TOOL,
  DB_QUERY_TOOL,
  LOGS_TAIL_TOOL,
  LOGS_SEARCH_TOOL,
  EVENTS_RECENT_TOOL,
  REGISTRY_LIST_TOOL,
  DIAGNOSTICS_EXPORT_TOOL,
  PLUGIN_RELOAD_TOOL,
  PLUGIN_ENABLE_TOOL,
  PLUGIN_DISABLE_TOOL,
  NAVIGATE_TOOL,
]

export const OBSERVE_TOOLS: readonly DebugToolDefinition[] = DEBUG_TOOLS.filter(
  tool => tool.kind === 'observe',
)

export const CONTROL_TOOLS: readonly DebugToolDefinition[] = DEBUG_TOOLS.filter(
  tool => tool.kind === 'control',
)

export function findDebugTool(name: string): DebugToolDefinition | undefined {
  return DEBUG_TOOLS.find(tool => tool.name === name)
}