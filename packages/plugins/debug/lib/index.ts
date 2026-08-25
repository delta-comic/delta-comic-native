import type { DebugHello } from '@delta-comic/protocol'
/**
 * Dev MCP 调试通道官方插件（架构 §13）。
 *
 * - __DEV__ 门控：生产构建零包含，isDevMode() 为 false 时 apply 直接返回
 * - 服务投影、环形捕获与命令执行只经既有服务公开 API
 * - createDebugPlugin 供测试直调；apply 负责门控与 effect 化生命周期
 */
import type { Context, Disposable } from 'cordis'

import { DebugBridge, type WebSocketFactory } from './bridge'
import { attachDebugCapture } from './capture'
import { buildHandlers } from './handlers'

export {
  DebugBridge,
  defaultSocketFactory,
  type WebSocketFactory,
  type WebSocketLike,
} from './bridge'
export { attachDebugCapture, RingBuffer, matchLogEntry } from './capture'
export { buildHandlers, DebugToolError, assertReadOnlySql } from './handlers'
export { safeSerialize } from './serialize'

/** 官方调试插件 manifest（供宿主发现管线使用）。 */
export const debugManifest = {
  id: 'debug',
  name: 'Dev MCP 调试通道',
  version: '1.0.0',
  hostVersion: '>=1.0.0',
  entries: { common: { path: 'index.js', sha256: '0'.repeat(64) } },
  runtime: {
    rn: '^0.87.0',
    hermes: '^2026.1.0',
    bytecode: 96,
    cpu: ['arm64', 'x64'],
    compileOptions: { dev: 'false' },
  },
  network: { multiEdge: false },
  capabilities: ['dev-debug'],
} as const

export interface DebugPluginOptions {
  readonly url: string
  readonly appId: string
  readonly platform: string
  readonly appVersion: string
  readonly hostVersion?: string
  readonly capacity?: number
  readonly socketFactory?: WebSocketFactory
}

/** __DEV__ 判定：宿主注入的 globalThis.__DEV__ 优先，缺省回退 NODE_ENV。 */
export function isDevMode(): boolean {
  const flag = (globalThis as Partial<Record<'__DEV__', unknown>>).__DEV__
  if (typeof flag === 'boolean') return flag
  return process.env.NODE_ENV !== 'production'
}

/**
 * 组装并启动调试桥（不做 __DEV__ 判定）；随返回 disposer 停止。
 * inject：database / pluginLoader / routeRegistry / uiRegistry / navigation。
 */
export function createDebugPlugin(ctx: Context, options: DebugPluginOptions): Disposable {
  const capture = attachDebugCapture(ctx, options.capacity ?? 500)
  const handlers = buildHandlers(
    {
      appId: options.appId,
      platform: options.platform,
      appVersion: options.appVersion,
      hostVersion: options.hostVersion,
      db: ctx.database.db,
      loader: ctx.pluginLoader,
      routeRegistry: ctx.routeRegistry,
      uiRegistry: ctx.uiRegistry,
      navigation: ctx.navigation,
    },
    capture,
  )
  const hello: DebugHello = {
    v: 1,
    kind: 'hello',
    appId: options.appId,
    platform: options.platform,
    appVersion: options.appVersion,
    ...(options.hostVersion === undefined ? {} : { hostVersion: options.hostVersion }),
  }
  const bridge = new DebugBridge({
    url: options.url,
    hello,
    handlers,
    socketFactory: options.socketFactory,
  })
  bridge.start()
  return () => bridge.stop()
}

export function apply(ctx: Context): void {
  if (!isDevMode()) return
  ctx.effect(() =>
    createDebugPlugin(ctx, {
      url: process.env.DC_DEV_MCP_URL ?? 'ws://127.0.0.1:7529/app?token=dev',
      appId: process.env.DC_DEV_APP_ID ?? `${process.env.DC_DEV_PLATFORM ?? 'dev'}-device`,
      platform: process.env.DC_DEV_PLATFORM ?? 'dev',
      appVersion: process.env.DC_DEV_APP_VERSION ?? '0.0.0-dev',
      hostVersion: process.env.DC_DEV_HOST_VERSION,
    }),
  )
}