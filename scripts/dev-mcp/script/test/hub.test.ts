import { makeDebugError, makeDebugSuccess } from '@delta-comic/protocol'
import { describe, expect, it, vi } from 'vitest'

import { DeviceHub, ToolCallError } from '../../src/hub'

const HELLO = {
  v: 1,
  kind: 'hello',
  appId: 'sim-01',
  platform: 'ios',
  appVersion: '1.0.0',
  hostVersion: '1.0.0',
} as const

type Ws = InstanceType<typeof globalThis.WebSocket>

async function connect(port: number, query = 'token=tok'): Promise<Ws> {
  const socket = new globalThis.WebSocket(`ws://127.0.0.1:${port}/app?${query}`)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve()
    socket.onerror = () => reject(new Error('连接失败'))
  })
  return socket
}

async function nextMessage(socket: Ws): Promise<Record<string, unknown>> {
  return new Promise(resolve => {
    const listener = (event: MessageEvent): void => {
      socket.removeEventListener('message', listener)
      resolve(JSON.parse(String(event.data)) as Record<string, unknown>)
    }
    socket.addEventListener('message', listener)
  })
}

describe('DeviceHub', () => {
  it('token 不匹配的连接被立即拒绝', async () => {
    const hub = new DeviceHub()
    const port = await hub.start({ port: 0, token: 'tok' })
    try {
      const closed = new Promise<number>(resolve => {
        const socket = new globalThis.WebSocket(`ws://127.0.0.1:${port}/app?token=bad`)
        socket.onclose = event => resolve(event.code)
        socket.onerror = () => undefined
      })
      await expect(closed).resolves.toBe(4001)
      expect(hub.apps()).toEqual([])
    } finally {
      await hub.stop()
    }
  })

  it('hello 登记后转发请求并回传响应结果', async () => {
    const hub = new DeviceHub()
    const port = await hub.start({ port: 0, token: 'tok' })
    try {
      const socket = await connect(port)
      socket.send(JSON.stringify(HELLO))
      await vi.waitFor(() => expect(hub.apps()).toHaveLength(1))

      const pending = hub.request('app_info', {})
      const frame = await nextMessage(socket)
      expect(frame).toMatchObject({ kind: 'request', tool: 'app_info' })
      const id = frame.id
      expect(typeof id).toBe('string')

      socket.send(JSON.stringify(makeDebugSuccess(id as string, { version: '1.0.0' })))
      await expect(pending).resolves.toEqual({ version: '1.0.0' })
      socket.close()
    } finally {
      await hub.stop()
    }
  })

  it('错误帧转换为带稳定错误码的 ToolCallError', async () => {
    const hub = new DeviceHub()
    const port = await hub.start({ port: 0, token: 'tok' })
    try {
      const socket = await connect(port)
      socket.send(JSON.stringify(HELLO))
      await vi.waitFor(() => expect(hub.apps()).toHaveLength(1))

      const pending = hub.request('navigate', { key: 'core/detail' })
      const frame = await nextMessage(socket)
      socket.send(
        JSON.stringify(
          makeDebugError(frame.id as string, 'ROUTE_NOT_FOUND', '路由未注册：core/detail'),
        ),
      )
      await expect(pending).rejects.toMatchObject({
        name: 'ToolCallError',
        code: 'ROUTE_NOT_FOUND',
      } satisfies Partial<ToolCallError>)
      socket.close()
    } finally {
      await hub.stop()
    }
  })

  it('同 appId 新连接顶替旧连接，后续请求走新连接', async () => {
    const hub = new DeviceHub()
    const port = await hub.start({ port: 0, token: 'tok' })
    try {
      const first = await connect(port)
      first.send(JSON.stringify(HELLO))
      await vi.waitFor(() => expect(hub.apps()).toHaveLength(1))

      const replaced = new Promise<void>(resolve => {
        first.onclose = () => resolve()
      })

      const second = await connect(port)
      second.send(JSON.stringify(HELLO))
      await replaced

      expect(hub.apps()).toHaveLength(1)
      const pending = hub.request('app_info', {})
      const frame = await nextMessage(second)
      second.send(JSON.stringify(makeDebugSuccess(frame.id as string, { via: 'second' })))
      await expect(pending).resolves.toEqual({ via: 'second' })
      first.close()
      second.close()
    } finally {
      await hub.stop()
    }
  })

  it('超时未响应则调用以错误拒绝', async () => {
    const hub = new DeviceHub()
    const port = await hub.start({ port: 0, token: 'tok' })
    try {
      const socket = await connect(port)
      socket.send(JSON.stringify(HELLO))
      await vi.waitFor(() => expect(hub.apps()).toHaveLength(1))

      await expect(hub.request('app_info', {}, 20)).rejects.toThrow('工具调用超时：app_info')
      socket.close()
    } finally {
      await hub.stop()
    }
  })

  it('没有设备连接时请求直接失败', async () => {
    const hub = new DeviceHub()
    await hub.start({ port: 0, token: 'tok' })
    try {
      await expect(hub.request('app_info', {})).rejects.toThrow('没有已连接的调试设备')
    } finally {
      await hub.stop()
    }
  })
})