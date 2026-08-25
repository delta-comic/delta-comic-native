/**
 * 调试 WebSocket 桥。
 *
 * - 连接成功即发送 hello 宣告；此后仅处理 request 并回 response
 * - 断线按指数退避重连（1s 起，封顶 15s，成功后复位）
 * - WebSocket 抽象为最小结构面：RN/Web/Node22+ 原生构造器均可注入
 */
import {
  findDebugTool,
  makeDebugError,
  makeDebugSuccess,
  parseDebugMessage,
  type DebugHello,
} from '@delta-comic/protocol'
import { Value } from 'typebox/value'

import { DebugToolError, type DebugHandler } from './handlers'

export interface WebSocketLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { readonly data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: ((error: unknown) => void) | null
}

/** 环境收敛点：各平台原生 WebSocket 构造器统一按最小结构面消费。 */
export type WebSocketFactory = (url: string) => WebSocketLike

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

export interface DebugBridgeOptions {
  readonly url: string
  readonly hello: DebugHello
  readonly handlers: Record<string, DebugHandler>
  readonly socketFactory?: WebSocketFactory
  /** 收到无法处理的帧时的观测口（测试与日志用）。 */
  readonly onError?: (error: unknown) => void
}

export function defaultSocketFactory(url: string): WebSocketLike {
  const constructor = (globalThis as Partial<Record<'WebSocket', unknown>>).WebSocket
  if (typeof constructor !== 'function') {
    throw new Error('当前环境缺少 WebSocket 实现')
  }
  return new (constructor as new (url: string) => WebSocketLike)(url)
}

export class DebugBridge {
  private socket: WebSocketLike | undefined
  private disposed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private delay = RECONNECT_BASE_MS

  constructor(private readonly options: DebugBridgeOptions) {}

  start(): void {
    this.disposed = false
    this.connect()
  }

  stop(): void {
    this.disposed = true
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.close()
    this.socket = undefined
  }

  /** 测试钩子：直连一帧文本处理并取回待发送出站帧。 */
  handleFrame(raw: string): string[] {
    return this.dispatch(raw)
  }

  private connect(): void {
    if (this.disposed) return
    const factory = this.options.socketFactory ?? defaultSocketFactory
    let socket: WebSocketLike
    try {
      socket = factory(this.options.url)
    } catch (error) {
      this.options.onError?.(error)
      this.scheduleReconnect()
      return
    }
    this.socket = socket
    socket.onopen = () => {
      this.delay = RECONNECT_BASE_MS
      socket.send(JSON.stringify(this.options.hello))
    }
    socket.onmessage = event => {
      const frames = this.dispatch(typeof event.data === 'string' ? event.data : '')
      for (const frame of frames) socket.send(frame)
    }
    socket.onclose = () => {
      if (this.socket === socket) this.socket = undefined
      this.scheduleReconnect()
    }
    socket.onerror = error => {
      this.options.onError?.(error)
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== undefined) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, this.delay)
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS)
  }

  /** 处理一帧入站消息，返回待发送的出站帧列表。 */
  private dispatch(raw: string): string[] {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      this.options.onError?.(error)
      return []
    }
    const validated = parseDebugMessage(parsed)
    if (!validated.ok || validated.message.kind !== 'request') {
      this.options.onError?.(
        validated.ok ? `非 request 帧：${validated.message.kind}` : validated.issues,
      )
      return []
    }
    const request = validated.message
    const handler = this.options.handlers[request.tool]
    if (handler === undefined) {
      return [
        JSON.stringify(makeDebugError(request.id, 'TOOL_NOT_FOUND', `未知工具：${request.tool}`)),
      ]
    }
    const tool = findDebugTool(request.tool)
    if (tool === undefined || !Value.Check(tool.input, request.params)) {
      const issue =
        tool === undefined ? undefined : [...Value.Errors(tool.input, request.params)][0]
      return [
        JSON.stringify(
          makeDebugError(
            request.id,
            'INVALID_PARAMS',
            `${request.tool} 入参不合法：${issue?.instancePath ?? '/'} ${issue?.message ?? ''}`,
          ),
        ),
      ]
    }
    try {
      const result = handler(request.params as Record<string, unknown>)
      if (result instanceof Promise) {
        // 异步结果经闭包续发；同步返回空表示稍后再发
        void result.then(
          value => this.sendToSocket(request.id, value),
          error => this.sendErrorToSocket(request.id, error),
        )
        return []
      }
      return [JSON.stringify(makeDebugSuccess(request.id, result))]
    } catch (error) {
      return [this.errorFrame(request.id, error)]
    }
  }

  private errorFrame(id: string, error: unknown): string {
    const code = error instanceof DebugToolError ? error.code : 'TOOL_FAILED'
    const message = error instanceof Error ? error.message : String(error)
    return JSON.stringify(makeDebugError(id, code, message))
  }

  private sendToSocket(id: string, result: unknown): void {
    this.deliver(JSON.stringify(makeDebugSuccess(id, result)))
  }

  private sendErrorToSocket(id: string, error: unknown): void {
    this.deliver(this.errorFrame(id, error))
  }

  private deliver(frame: string): void {
    this.socket?.send(frame)
  }
}