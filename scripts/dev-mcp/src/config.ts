import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** 操控类工具逐项放行开关，缺省全部关闭。 */
export interface ControlAllow {
  navigate?: boolean
  plugin_reload?: boolean
  plugin_enable?: boolean
  plugin_disable?: boolean
}

export interface DevMcpConfig {
  /** WS hub 监听端口。 */
  port: number
  /** 应用侧连接配对 token。 */
  token: string
  /** 操控工具门控。 */
  allow: ControlAllow
}

export function defaultConfig(): DevMcpConfig {
  return { port: 7529, token: randomBytes(16).toString('hex'), allow: {} }
}

/**
 * 读取配置文件并与默认值合并；未提供路径或字段缺失时使用默认值。
 */
export function loadConfig(path?: string): DevMcpConfig {
  const base = defaultConfig()
  if (path === undefined) return base
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<DevMcpConfig>
  return {
    port: raw.port ?? base.port,
    token: raw.token ?? base.token,
    allow: { ...base.allow, ...raw.allow },
  }
}