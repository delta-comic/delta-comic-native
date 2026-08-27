import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  buildTools,
  createDevMcpServer,
  DeviceHub,
  loadConfig,
  type AuditEntry,
  type DevMcpConfig,
} from '@delta-comic/dev-mcp'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { cac } from 'cac'

const cli = cac('dcd')
cli
  .command('[root]', '同进程编排 vp dev 与 dev-mcp（MCP 走 stdout，vite 日志转发到 stderr）')
  .option('--config <path>', 'dev-mcp 配置文件路径')
  .option('--port <port>', 'DeviceHub 端口（覆盖配置）')
  .allowUnknownOptions()
  .action(() => {})

function strOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function portOption(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return undefined
}

/** MCP stdio 只占用本进程 stdout，vite 子进程日志统一转发到 stderr。 */
function resolveVpBin(): string {
  const local = fileURLToPath(new URL('../../../node_modules/.bin/vp', import.meta.url))
  return existsSync(local) ? local : 'vp'
}

function forward(child: ChildProcess): void {
  child.stdout?.on('data', chunk => process.stderr.write(chunk))
  child.stderr?.on('data', chunk => process.stderr.write(chunk))
}

function appendAudit(path: string, entry: AuditEntry): void {
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8')
}

async function main(): Promise<void> {
  try {
    cli.parse(process.argv, { run: false })
  } catch (error) {
    console.error('[dev] 参数错误：', error instanceof Error ? error.message : error)
    process.exitCode = 1
    return
  }
  const config: DevMcpConfig = loadConfig(strOption(cli.options.config))
  const auditPath = strOption(cli.options.audit) ?? '.delta-dev-mcp.audit.jsonl'
  const hub = new DeviceHub()
  const port = await hub.start({
    port: portOption(cli.options.port) ?? config.port,
    token: config.token,
  })
  const tools = buildTools({
    request: (tool, params) => hub.request(tool, params),
    allow: config.allow,
    audit: entry => appendAudit(auditPath, entry),
  })
  const server = createDevMcpServer(tools)

  const viteArgs = cli.args.filter(arg => !arg.startsWith('-'))
  const viteRoot = typeof viteArgs[0] === 'string' ? viteArgs[0] : undefined
  // 把实际 ws 配对地址经 VITE_ 环境变量注入 Web 宿主，供 debug 插件读取
  const viteEnv = {
    ...process.env,
    VITE_DELTA_DEV_MCP_URL: `ws://127.0.0.1:${port}/app?token=${config.token}`,
  }
  const vite = spawn(resolveVpBin(), viteRoot === undefined ? ['dev'] : ['dev', viteRoot], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: viteEnv,
  })
  forward(vite)
  console.error(`[dev] vp dev pid=${String(vite.pid)}`)
  console.error(`[dev] ws://127.0.0.1:${port}/app?token=${config.token}`)
  console.error(`[dev] 操控门控 ${JSON.stringify(config.allow)}`)
  console.error(`[dev] 审计日志 ${auditPath}`)

  let settled = false
  let closeMcp: (() => Promise<void>) | undefined
  const shutdown = (code: number): void => {
    if (settled) return
    settled = true
    vite.kill('SIGTERM')
    void (closeMcp === undefined ? Promise.resolve() : closeMcp().catch(() => {}))
      .then(() => hub.stop())
      .catch(() => {})
      .finally(() => process.exit(code))
  }

  vite.on('exit', code => {
    console.error(`[dev] vp dev 退出（${String(code)}）`)
    shutdown(code ?? 1)
  })
  const handle = serveStdio(() => server)
  closeMcp = () => handle.close()
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  await new Promise<never>(() => {})
}

main().catch(error => {
  console.error('[dev] 启动失败：', error)
  process.exit(1)
})