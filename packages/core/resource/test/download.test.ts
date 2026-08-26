import { createHash } from 'node:crypto'

import { RangeUnsupportedError } from '@delta-comic/protocol'
import type { ResourceProvider } from '@delta-comic/protocol'
import type { Context } from 'cordis'
import { describe, expect, it, vi } from 'vitest'

import { ChecksumMismatchError, DownloadService, type DownloadSnapshot } from '../lib/download'
import type { DownloadSink } from '../lib/download'
import { DownloadTaskRepository } from '../lib/repository'
import { ResourceRuntimeService } from '../lib/runtime'

import { createContext, createTestDb } from './util'

const sha256Hex = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex')

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

interface MemorySink extends DownloadSink {
  data(destKey: string): Uint8Array
  resetCalls(): number
  removeCalls(): number
}

function createMemorySink(seed?: Record<string, readonly Uint8Array[]>): MemorySink {
  const buffers = new Map<string, Uint8Array[]>()
  for (const [destKey, parts] of Object.entries(seed ?? {})) buffers.set(destKey, [...parts])
  let resets = 0
  let removes = 0
  const sizeOf = (destKey: string): number =>
    (buffers.get(destKey) ?? []).reduce((sum, part) => sum + part.byteLength, 0)
  return {
    probe: async destKey => sizeOf(destKey),
    append: async (destKey, offset, chunk) => {
      if (offset !== sizeOf(destKey)) {
        throw new Error(`sink 偏移断裂：期望 ${sizeOf(destKey)}，收到 ${offset}`)
      }
      const parts = buffers.get(destKey) ?? []
      parts.push(chunk)
      buffers.set(destKey, parts)
    },
    reset: async destKey => {
      resets += 1
      buffers.set(destKey, [])
    },
    finalize: async () => {},
    remove: async destKey => {
      removes += 1
      buffers.delete(destKey)
    },
    data: destKey => concat(buffers.get(destKey) ?? []),
    resetCalls: () => resets,
    removeCalls: () => removes,
  }
}

/** 分块 provider：每块可挂独立闸门，支持 offset 续传与 Range 拒绝。 */
function chunkProvider(options?: { gates?: number; rejectRange?: boolean }) {
  const releases: Array<() => void> = []
  const gatePromises: Array<Promise<void>> = []
  for (let index = 0; index < (options?.gates ?? 0); index += 1) {
    gatePromises.push(
      new Promise<void>(resolve => {
        releases.push(resolve)
      }),
    )
  }
  const releaseAll = (): void => {
    for (const release of releases.splice(0)) release()
  }
  const releaseAt = (index: number): void => {
    releases[index]?.()
  }
  const lastOffsets: number[] = []
  const chunks = [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])]
  const full = concat(chunks)
  const provider: ResourceProvider = {
    id: 'p',
    kind: 'file',
    resolve: async ref => ({
      ...ref,
      size: full.byteLength,
      checksum: { algorithm: 'sha256', digest: sha256Hex(full) },
    }),
    open(_descriptor, openOptions) {
      const offset = openOptions?.offset ?? 0
      if (options?.rejectRange === true && offset > 0) throw new RangeUnsupportedError()
      lastOffsets.push(offset)
      async function* generate(): AsyncGenerator<Uint8Array> {
        let position = 0
        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index]
          if (position + chunk.byteLength <= offset) {
            position += chunk.byteLength
            continue
          }
          const gate = gatePromises[index]
          if (gate !== undefined) await gate
          yield chunk
          position += chunk.byteLength
        }
      }
      return generate()
    },
  }
  return { provider, releaseAll, releaseAt, offsets: lastOffsets, full }
}

interface Harness {
  readonly ctx: Context
  readonly service: DownloadService
  readonly sink: MemorySink
  readonly tasks: DownloadTaskRepository
  snapshot(id: string): DownloadSnapshot | undefined
  waitForStatus(id: string, status: DownloadSnapshot['status']): Promise<void>
  waitForReceived(id: string, bytes: number): Promise<void>
  destroy(): Promise<void>
}

async function createHarness(
  provider: ResourceProvider,
  options?: { sink?: MemorySink; concurrency?: number; runtime?: ResourceRuntimeService },
): Promise<Harness> {
  const target = await createTestDb()
  const ctx = createContext()
  const runtime = options?.runtime ?? new ResourceRuntimeService(ctx)
  runtime.registerProvider(provider)
  const sink = options?.sink ?? createMemorySink()
  const tasks = new DownloadTaskRepository(target.db)
  const service = new DownloadService(ctx, {
    tasks,
    sink,
    runtime,
    concurrency: options?.concurrency,
  })
  const snapshot = (id: string): DownloadSnapshot | undefined =>
    service.snapshots().find(task => task.id === id)
  return {
    ctx,
    service,
    sink,
    tasks,
    snapshot,
    waitForStatus: async (id, status) => {
      await vi.waitFor(() => {
        expect(snapshot(id)?.status).toBe(status)
      })
    },
    waitForReceived: async (id, bytes) => {
      await vi.waitFor(() => {
        expect(snapshot(id)?.receivedBytes).toBe(bytes)
      })
    },
    destroy: async () => {
      await target.destroy()
    },
  }
}

describe('DownloadService', () => {
  it('全路径下载完成并校验 sha256', async () => {
    const { provider, full } = chunkProvider()
    const harness = await createHarness(provider)
    try {
      const statuses: string[] = []
      harness.ctx.on('download/task-changed', task => {
        statuses.push(task.status)
      })
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await harness.waitForStatus('d1', 'completed')
      expect(harness.sink.data('dest-1')).toEqual(full)
      expect(harness.snapshot('d1')).toMatchObject({
        id: 'd1',
        status: 'completed',
        receivedBytes: full.byteLength,
        totalBytes: full.byteLength,
      })
      expect(statuses[0]).toBe('queued')
      expect(statuses).toContain('running')
      expect(statuses[statuses.length - 1]).toBe('completed')
    } finally {
      await harness.destroy()
    }
  })

  it('从 sink 已有字节断点续传', async () => {
    const partial = new Uint8Array([1, 2, 3, 4])
    const seeded = createMemorySink({ 'dest-1': [partial] })
    const { provider, offsets, full } = chunkProvider()
    const harness = await createHarness(provider, { sink: seeded })
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await harness.waitForStatus('d1', 'completed')
      expect(offsets).toContain(4)
      expect(harness.sink.data('dest-1')).toEqual(full)
      expect(harness.snapshot('d1')?.receivedBytes).toBe(full.byteLength)
    } finally {
      await harness.destroy()
    }
  })

  it('provider 拒绝 Range 时清空重传一次', async () => {
    const partial = new Uint8Array([1, 2])
    const seeded = createMemorySink({ 'dest-1': [partial] })
    const { provider, full } = chunkProvider({ rejectRange: true })
    const harness = await createHarness(provider, { sink: seeded })
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await harness.waitForStatus('d1', 'completed')
      expect(harness.sink.resetCalls()).toBe(1)
      expect(harness.sink.data('dest-1')).toEqual(full)
    } finally {
      await harness.destroy()
    }
  })

  it('校验和不符落 failed，修正后 retry 完成', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx, { ttlMs: 0 })
    let digest = 'bad-digest'
    const full = new Uint8Array([7, 7, 7])
    const provider: ResourceProvider = {
      id: 'p',
      kind: 'file',
      resolve: async ref => ({
        ...ref,
        size: full.byteLength,
        checksum: { algorithm: 'sha256', digest },
      }),
      open(_descriptor, openOptions) {
        async function* generate(offset: number): AsyncGenerator<Uint8Array> {
          if (offset < full.byteLength) yield full.subarray(offset)
        }
        return generate(openOptions?.offset ?? 0)
      },
    }
    const harness = await createHarness(provider, { runtime })
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await harness.waitForStatus('d1', 'failed')
      expect(harness.snapshot('d1')?.error).toContain('校验和不符')
      digest = sha256Hex(full)
      await harness.service.retry('d1')
      await harness.waitForStatus('d1', 'completed')
      expect(harness.sink.data('dest-1')).toEqual(full)
    } finally {
      await harness.destroy()
    }
  })

  it('并发受上限约束且完成后自动补泵', async () => {
    const pending: Array<() => void> = []
    let active = 0
    let maxActive = 0
    const provider: ResourceProvider = {
      id: 'p',
      kind: 'file',
      resolve: async ref => ({ ...ref }),
      open() {
        active += 1
        maxActive = Math.max(maxActive, active)
        const iterator: AsyncIterator<Uint8Array> = {
          next: async () => {
            await new Promise<void>(resolve => {
              pending.push(() => {
                active -= 1
                resolve()
              })
            })
            return { done: true as const, value: undefined }
          },
        }
        return { [Symbol.asyncIterator]: () => iterator }
      },
    }
    const harness = await createHarness(provider, { concurrency: 2 })
    try {
      await harness.service.enqueue('t1', 'file', 'r1', 'k1')
      await harness.service.enqueue('t2', 'file', 'r2', 'k2')
      await harness.service.enqueue('t3', 'file', 'r3', 'k3')
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      expect(maxActive).toBe(2)
      for (const release of pending.splice(0)) release()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      expect(maxActive).toBe(2)
      for (const release of pending.splice(0)) release()
      await harness.waitForStatus('t3', 'completed')
      expect(harness.snapshot('t1')?.status).toBe('completed')
      expect(harness.snapshot('t2')?.status).toBe('completed')
    } finally {
      await harness.destroy()
    }
  })

  it('活跃任务同 id enqueue 去重抛错', async () => {
    const { provider } = chunkProvider({ gates: 1 })
    const harness = await createHarness(provider)
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await expect(harness.service.enqueue('d1', 'file', 'r', 'dest-1')).rejects.toThrow(/已存在/)
      await harness.service.remove('d1')
    } finally {
      await harness.destroy()
    }
  })

  it('pause 后 resume 从续传点完成', async () => {
    const gated = chunkProvider({ gates: 2 })
    const harness = await createHarness(gated.provider)
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await vi.waitFor(() => expect(gated.offsets.length).toBeGreaterThan(0))
      gated.releaseAt(0)
      await harness.waitForReceived('d1', 4)
      await harness.service.pause('d1')
      expect(harness.snapshot('d1')?.status).toBe('paused')
      await harness.service.resume('d1')
      gated.releaseAt(1)
      await harness.waitForStatus('d1', 'completed')
      expect(gated.offsets).toContain(4)
      expect(harness.sink.data('dest-1')).toEqual(gated.full)
    } finally {
      await harness.destroy()
    }
  })

  it('cancel 终态化并中断进行中任务', async () => {
    const gated = chunkProvider({ gates: 2 })
    const harness = await createHarness(gated.provider)
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await vi.waitFor(() => expect(gated.offsets.length).toBeGreaterThan(0))
      gated.releaseAt(0)
      await harness.waitForReceived('d1', 4)
      await harness.service.cancel('d1')
      expect(harness.snapshot('d1')?.status).toBe('cancelled')
      gated.releaseAll()
      expect(harness.snapshot('d1')?.status).toBe('cancelled')
      await expect(harness.service.cancel('d1')).rejects.toThrow(/终态/)
    } finally {
      await harness.destroy()
    }
  })

  it('remove 清理仓库与落地数据', async () => {
    const gated = chunkProvider({ gates: 2 })
    const harness = await createHarness(gated.provider)
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await vi.waitFor(() => expect(gated.offsets.length).toBeGreaterThan(0))
      gated.releaseAt(0)
      await harness.waitForReceived('d1', 4)
      await harness.service.remove('d1')
      expect(harness.sink.removeCalls()).toBe(1)
      await expect(harness.tasks.get('d1')).resolves.toBeUndefined()
      expect(harness.snapshot('d1')).toBeUndefined()
      await expect(harness.service.remove('d1')).rejects.toThrow(/不存在/)
      gated.releaseAll()
    } finally {
      await harness.destroy()
    }
  })

  it('recoverStale 将遗留 running 任务重泵至完成并持久化', async () => {
    const { provider, full } = chunkProvider()
    const harness = await createHarness(provider)
    try {
      await harness.tasks.insert({
        id: 'stale',
        kind: 'file',
        ref: 'r',
        destKey: 'dest-stale',
        status: 'running',
        receivedBytes: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      await harness.service.recoverStale()
      await harness.waitForStatus('stale', 'completed')
      expect(harness.sink.data('dest-stale')).toEqual(full)
      await expect(harness.tasks.get('stale')).resolves.toMatchObject({ status: 'completed' })
    } finally {
      await harness.destroy()
    }
  })

  it('未注册的校验算法使任务失败', async () => {
    const chunk = new Uint8Array([1])
    const provider: ResourceProvider = {
      id: 'p',
      kind: 'file',
      resolve: async ref => ({ ...ref, checksum: { algorithm: 'md5-unknown', digest: 'x' } }),
      open() {
        async function* generate(): AsyncGenerator<Uint8Array> {
          yield chunk
        }
        return generate()
      },
    }
    const harness = await createHarness(provider)
    try {
      await harness.service.enqueue('d1', 'file', 'r', 'dest-1')
      await harness.waitForStatus('d1', 'failed')
      expect(harness.snapshot('d1')?.error).toContain('未注册的校验算法')
      expect(new ChecksumMismatchError('a', 'b', 'c').name).toBe('ChecksumMismatchError')
    } finally {
      await harness.destroy()
    }
  })
})