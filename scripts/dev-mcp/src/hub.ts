import {
  makeDebugRequest,
  parseDebugMessage,
  type DebugMessage,
  type DebugSuccessResponse,
} from '@delta-comic/protocol'
import { WebSocketServer, type WebSocket } from 'ws'

export interface AppInfo {
  appId: string
  platform: string
  appVersion: string
  hostVersion?: string
}

export interface HubOptions {
  /** 默认绑定回环地址。 */
  host?: string
  /** 传 0 由系统分配端口。 */
  port: number
  token: string
}

/** 应用侧返回的错误帧。 */
export class ToolCallError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ToolCallError'
    this.code = code
  }
}

interface PendingCall {
  resolve: (result: DebugSuccessResponse['result']) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface DeviceConnection {
  socket: WebSocket
  hello: AppInfo
}

type InboundFrame = DebugMessage

/**
 * 多设备 WS hub：应用经 loopback WS 连入（path /app?token= 配对），
 * hello 后按 appId 登记，同 id 新连接顶替旧连接。
 */
export class DeviceHub {
  private wss: WebSocketServer | undefined
  private token = ''
  private connections = new Map<string, DeviceConnection>()
  private latestAppId: string | undefined
  private counter = 0
  private pending = new Map<string, PendingCall>()

  /** 启动监听并返回实际端口。 */
  start(options: HubOptions): Promise<number> {
    this.token = options.token
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ host: options.host ?? '127.0.0.1', port: options.port })
      this.wss = wss
      wss.on('error', reject)
      wss.on('connection', (socket, request) => this.handleConnection(socket, request.url ?? '/'))
      wss.on('listening', () => {
        const address = wss.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('WS hub 未获得端口'))
          return
        }
        resolve(address.port)
      })
    })
  }

  async stop(): Promise<void> {
    for (const call of this.pending.values()) {
      clearTimeout(call.timer)
      call.reject(new Error('hub 已停止'))
    }
    this.pending.clear()
    for (const connection of this.connections.values()) connection.socket.close()
    this.connections.clear()
    this.latestAppId = undefined
    const wss = this.wss
    if (wss === undefined) return
    await new Promise<void>((resolve, reject) => {
      wss.close(error => (error === undefined ? resolve() : reject(error)))
    })
    this.wss = undefined
  }

  /** 当前登记的应用列表，最近连接者排首。 */
  apps(): AppInfo[] {
    const latest = this.latestAppId
    return [...this.connections.entries()]
      .sort(([a], [b]) => Number(b === latest) - Number(a === latest))
      .map(([, connection]) => connection.hello)
  }

  /**
   * 向最近连接的应用转发一次工具调用并等待响应帧。
   * @param timeoutMs 响应超时，默认 10 秒。
   */
  request(
    tool: string,
    params: Record<string, unknown>,
    timeoutMs = 10_000,
  ): Promise<DebugSuccessResponse['result']> {
    const connection =
      this.latestAppId === undefined ? undefined : this.connections.get(this.latestAppId)
    if (connection === undefined) return Promise.reject(new Error('没有已连接的调试设备'))
    const id = `mcp-${++this.counter}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`工具调用超时：${tool}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      connection.socket.send(JSON.stringify(makeDebugRequest(id, tool, params)))
    })
  }

  private handleConnection(socket: WebSocket, url: string): void {
    const parsed = new URL(url, 'http://127.0.0.1')
    if (parsed.pathname !== '/app' || parsed.searchParams.get('token') !== this.token) {
      socket.close(4001, '配对失败：token 无效')
      return
    }

    let announced = false
    socket.on('message', data => {
      const raw =
        typeof data === 'string'
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data).toString('utf8')
            : Buffer.isBuffer(data)
              ? data.toString('utf8')
              : new TextDecoder().decode(data)
      const parsed = parseDebugMessage(safeParse(raw))
      if (!parsed.ok) return
      const frame: InboundFrame = parsed.message
      if (frame.kind === 'hello') {
        if (announced) return
        announced = true
        this.register(
          {
            appId: frame.appId,
            platform: frame.platform,
            appVersion: frame.appVersion,
            hostVersion: frame.hostVersion,
          },
          socket,
        )
        return
      }
      if (frame.kind === 'response') this.dispatchResponse(frame)
    })
  }

  private register(hello: AppInfo, socket: WebSocket): void {
    const previous = this.connections.get(hello.appId)
    if (previous !== undefined && previous.socket !== socket) {
      previous.socket.close(4000, '被新连接顶替')
    }
    this.connections.set(hello.appId, { socket, hello })
    this.latestAppId = hello.appId
  }

  private dispatchResponse(response: Extract<InboundFrame, { kind: 'response' }>): void {
    const pending = this.pending.get(response.id)
    if (pending === undefined) return
    this.pending.delete(response.id)
    clearTimeout(pending.timer)
    if (response.ok) pending.resolve(response.result)
    else pending.reject(new ToolCallError(response.error.code, response.error.message))
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}