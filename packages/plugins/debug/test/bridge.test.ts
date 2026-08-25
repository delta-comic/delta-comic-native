import { validateManifest } from '@delta-comic/protocol'
import { Context } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DebugBridge, type WebSocketLike } from '../lib/bridge'
import { createDebugPlugin, debugManifest, isDevMode } from '../lib/index'

import { createFixture } from './fixture'

class FakeSocket implements WebSocketLike {
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { readonly data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  pushInbound(value: unknown): Record<string, unknown>[] {
    const before = this.sent.length
    this.onmessage?.({ data: JSON.stringify(value) })
    return this.sent.slice(before).map(frame => JSON.parse(frame) as Record<string, unknown>)
  }
}

function helloOf(socket: FakeSocket): Record<string, unknown> {
  return JSON.parse(socket.sent[0] ?? '{}') as Record<string, unknown>
}

describe('DebugBridge', () => {
  it('连接成功后发送 hello 宣告', () => {
    const socket = new FakeSocket()
    const bridge = new DebugBridge({
      url: 'ws://127.0.0.1:1/app',
      hello: { v: 1, kind: 'hello', appId: 'dev-1', platform: 'ios', appVersion: '1.0.0' },
      handlers: {},
      socketFactory: () => socket,
    })
    bridge.start()
    socket.onopen?.()
    expect(helloOf(socket)).toMatchObject({ kind: 'hello', appId: 'dev-1' })
    bridge.stop()
  })

  it('未知工具回 TOOL_NOT_FOUND，入参不合法回 INVALID_PARAMS', () => {
    const socket = new FakeSocket()
    const bridge = new DebugBridge({
      url: 'ws://x',
      hello: { v: 1, kind: 'hello', appId: 'a', platform: 'ios', appVersion: '1' },
      handlers: {
        app_info: () => ({}),
        plugin_detail: () => ({ found: false }),
        navigate: () => ({}),
      },
      socketFactory: () => socket,
    })
    bridge.start()
    socket.sent.length = 0

    const missing = socket.pushInbound({
      v: 1,
      kind: 'request',
      id: 'r1',
      tool: 'nope',
      params: {},
    })
    expect(missing[0]).toMatchObject({
      kind: 'response',
      id: 'r1',
      ok: false,
      error: { code: 'TOOL_NOT_FOUND' },
    })

    const invalid = socket.pushInbound({
      v: 1,
      kind: 'request',
      id: 'r2',
      tool: 'plugin_detail',
      params: {},
    })
    expect(invalid[0]).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } })

    const empty = socket.pushInbound({
      v: 1,
      kind: 'request',
      id: 'r3',
      tool: 'app_info',
      params: {},
    })
    expect(empty[0]).toMatchObject({ kind: 'response', id: 'r3', ok: true, result: {} })
    bridge.stop()
  })

  it('异步 handler 结果续发，DebugToolError 透传稳定错误码', async () => {
    const socket = new FakeSocket()
    const { DebugToolError } = await import('../lib/handlers')
    const bridge = new DebugBridge({
      url: 'ws://x',
      hello: { v: 1, kind: 'hello', appId: 'a', platform: 'ios', appVersion: '1' },
      handlers: {
        app_info: () => Promise.resolve({ value: 42 }),
        navigate: () => {
          throw new DebugToolError('ROUTE_NOT_FOUND', '路由未注册：core/detail')
        },
      },
      socketFactory: () => socket,
    })
    bridge.start()
    socket.sent.length = 0

    socket.pushInbound({ v: 1, kind: 'request', id: 's1', tool: 'app_info', params: {} })
    await vi.waitFor(() => {
      expect(
        socket.sent.some(frame => frame.includes('"id":"s1"') && frame.includes('"ok":true')),
      ).toBe(true)
    })
    const slow = JSON.parse(
      socket.sent.find(frame => frame.includes('"id":"s1"')) ?? '{}',
    ) as Record<string, unknown>
    expect(slow).toMatchObject({ ok: true, result: { value: 42 } })

    const boom = socket.pushInbound({
      v: 1,
      kind: 'request',
      id: 's2',
      tool: 'navigate',
      params: { key: 'core/detail' },
    })
    expect(boom[0]).toMatchObject({ ok: false, error: { code: 'ROUTE_NOT_FOUND' } })
    bridge.stop()
  })

  it('非 JSON 与非 request 帧被忽略并回调 onError', () => {
    const errors: unknown[] = []
    const socket = new FakeSocket()
    const bridge = new DebugBridge({
      url: 'ws://x',
      hello: { v: 1, kind: 'hello', appId: 'a', platform: 'ios', appVersion: '1' },
      handlers: {},
      socketFactory: () => socket,
      onError: error => errors.push(error),
    })
    bridge.start()
    socket.sent.length = 0

    socket.onmessage?.({ data: '{broken json' })
    socket.pushInbound({ v: 1, kind: 'hello', appId: 'echo', platform: 'web', appVersion: '1' })
    expect(socket.sent.filter(frame => frame.includes('response'))).toEqual([])
    expect(errors.length).toBeGreaterThanOrEqual(2)
    bridge.stop()
  })

  it('断线按指数退避重连且 stop 后停止', () => {
    vi.useFakeTimers()
    try {
      let created = 0
      const sockets: FakeSocket[] = []
      const bridge = new DebugBridge({
        url: 'ws://x',
        hello: { v: 1, kind: 'hello', appId: 'a', platform: 'ios', appVersion: '1' },
        handlers: {},
        socketFactory: () => {
          created += 1
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      })
      bridge.start()
      expect(created).toBe(1)

      sockets[0]?.onclose?.()
      vi.advanceTimersByTime(999)
      expect(created).toBe(1)
      vi.advanceTimersByTime(1)
      expect(created).toBe(2)

      sockets[1]?.onclose?.()
      vi.advanceTimersByTime(1999)
      expect(created).toBe(2)
      vi.advanceTimersByTime(1)
      expect(created).toBe(3)

      bridge.stop()
      sockets[2]?.onclose?.()
      vi.advanceTimersByTime(60000)
      expect(created).toBe(3)
      expect(sockets[2]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('__DEV__ 门控与插件装配', () => {
  const env = { ...process.env }

  afterEach(() => {
    delete (globalThis as Partial<Record<'__DEV__', unknown>>).__DEV__
    process.env = { ...env }
  })

  it('globalThis.__DEV__ 优先于 NODE_ENV', () => {
    ;(globalThis as Partial<Record<'__DEV__', unknown>>).__DEV__ = false
    expect(isDevMode()).toBe(false)
    ;(globalThis as Partial<Record<'__DEV__', unknown>>).__DEV__ = true
    expect(isDevMode()).toBe(true)
    delete (globalThis as Partial<Record<'__DEV__', unknown>>).__DEV__
    process.env.NODE_ENV = 'production'
    expect(isDevMode()).toBe(false)
    process.env.NODE_ENV = 'development'
    expect(isDevMode()).toBe(true)
  })

  it('debug manifest 通过协议校验', () => {
    const result = validateManifest(debugManifest)
    expect(result.ok).toBe(true)
  })

  it('createDebugPlugin 端到端：经桥处理请求并回响应', async () => {
    const fixture = await createFixture()
    const socket = new FakeSocket()
    const dispose = createDebugPlugin(fixture.ctx, {
      url: 'ws://memory/app',
      appId: 'sim-01',
      platform: 'ios',
      appVersion: '1.0.0',
      hostVersion: '1.0.0',
      socketFactory: () => socket,
    })
    socket.onopen?.()
    expect(helloOf(socket)).toMatchObject({ appId: 'sim-01', hostVersion: '1.0.0' })

    socket.sent.length = 0
    const [response] = socket.pushInbound({
      v: 1,
      kind: 'request',
      id: 'e1',
      tool: 'registry_list',
      params: {},
    })
    expect(response).toMatchObject({
      kind: 'response',
      id: 'e1',
      ok: true,
      result: { routes: ['core/detail'] },
    })

    fixture.ctx.logger.error('%d', 500)
    socket.sent.length = 0
    const [logs] = socket.pushInbound({
      v: 1,
      kind: 'request',
      id: 'e2',
      tool: 'logs_tail',
      params: { level: 'error' },
    })
    expect(logs).toMatchObject({ ok: true })
    expect((logs as { result?: { entries?: unknown[] } }).result?.entries).toHaveLength(1)

    dispose()
    expect(socket.closed).toBe(true)
    void new Context()
  })
})