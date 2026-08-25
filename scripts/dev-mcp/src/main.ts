import { appendFileSync } from 'node:fs'
import process from 'node:process'

import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { loadConfig } from './config'
import { DeviceHub } from './hub'
import { createDevMcpServer } from './mcp'
import { buildTools, type AuditEntry } from './tools'

function argOf(flag: string): string | undefined {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function appendAudit(path: string, entry: AuditEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

async function main(): Promise<void> {
  const config = loadConfig(argOf('--config'))
  const auditPath = argOf('--audit') ?? '.delta-dev-mcp.audit.jsonl'
  const hub = new DeviceHub()
  const port = await hub.start({ port: config.port, token: config.token })
  const tools = buildTools({
    request: (tool, params) => hub.request(tool, params),
    allow: config.allow,
    audit: entry => appendAudit(auditPath, entry),
  })
  const server = createDevMcpServer(tools)
  console.error(`[dev-mcp] ws://127.0.0.1:${port}/app?token=${config.token}`)
  console.error(`[dev-mcp] 操控门控 ${JSON.stringify(config.allow)}`)
  console.error(`[dev-mcp] 审计日志 ${auditPath}`)

  const handle = serveStdio(() => server)
  const shutdown = (): void => {
    void handle
      .close()
      .then(() => hub.stop())
      .finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(error => {
  console.error('[dev-mcp] 启动失败：', error)
  process.exit(1)
})