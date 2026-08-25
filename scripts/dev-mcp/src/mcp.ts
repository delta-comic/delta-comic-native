import { fromJsonSchema, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server'
import type { TSchema } from 'typebox'

import type { McpToolDef } from './tools'

/**
 * TypeBox schema 与 SDK JsonSchemaType 是两套类型系统的同一 JSON Schema 形状，
 * 结构等价，此处为文档化的跨库边界转换点。
 */
function toMcpInput(input: TSchema): StandardSchemaWithJSON<Record<string, unknown>> {
  return fromJsonSchema<Record<string, unknown>>(input as JsonSchemaType)
}

type StandardSchemaWithJSON<T> = ReturnType<typeof fromJsonSchema<T>>

/** 注册全部工具并返回未连接传输的 McpServer 实例。 */
export function createDevMcpServer(tools: readonly McpToolDef[]): McpServer {
  const server = new McpServer(
    { name: 'delta-comic-dev-mcp', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  for (const tool of tools) {
    const input = toMcpInput(tool.input)
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: input },
      async args => ({ content: [{ type: 'text', text: JSON.stringify(await tool.run(args)) }] }),
    )
  }
  return server
}