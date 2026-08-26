import { DEBUG_TOOLS } from '@delta-comic/protocol'
import type { TSchema } from 'typebox'

import type { ControlAllow } from './config.ts'

export interface AuditEntry {
  ts: string
  tool: string
  params: unknown
  ok: boolean
  durationMs: number
  error?: string
}

export interface ToolDeps {
  /** 向目标应用转发一次工具调用。 */
  request(tool: string, params: Record<string, unknown>): Promise<unknown>
  /** 操控工具逐项放行开关。 */
  allow: ControlAllow
  /** 每次调用落审计记录。 */
  audit(entry: AuditEntry): void
}

export interface McpToolDef {
  name: string
  title: string
  description: string
  input: TSchema
  run(params: Record<string, unknown>): Promise<unknown>
}

const CONTROL_TOOL_NAMES = new Set(['navigate', 'plugin_reload', 'plugin_enable', 'plugin_disable'])

/** 操控类工具须在 allow 中逐项开启，观察类默认可用。 */
export function isControlAllowed(name: string, allow: ControlAllow): boolean {
  if (!CONTROL_TOOL_NAMES.has(name)) return true
  return Boolean(allow[name as keyof ControlAllow])
}

/** 由共享注册表生成 MCP 工具定义，纯函数便于脱离 stdio 测试。 */
export function buildTools(deps: ToolDeps): McpToolDef[] {
  const tools: McpToolDef[] = []
  for (const tool of DEBUG_TOOLS) {
    if (!isControlAllowed(tool.name, deps.allow)) continue
    tools.push({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      input: tool.input,
      async run(params) {
        const startedAt = Date.now()
        try {
          const result = await deps.request(tool.name, params)
          deps.audit({
            ts: new Date().toISOString(),
            tool: tool.name,
            params,
            ok: true,
            durationMs: Date.now() - startedAt,
          })
          return result
        } catch (error) {
          deps.audit({
            ts: new Date().toISOString(),
            tool: tool.name,
            params,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      },
    })
  }
  return tools
}