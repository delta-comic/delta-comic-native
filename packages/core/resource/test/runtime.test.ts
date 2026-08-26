import { describe, expect, it } from 'vitest'

import { ResourceRepository } from '../lib/repository'
import { ResourceRuntimeService } from '../lib/runtime'
import { ResourceScope } from '../lib/scope'
import { createContext, createTestDb } from './util'

import type { ResourceDescriptor, ResourceProvider } from '@delta-comic/protocol'

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

interface ProviderHarness {
  readonly provider: ResourceProvider
  resolveCalls(): number
  setDescriptor(descriptor: Partial<ResourceDescriptor>): void
}

function countingProvider(
  kind: string,
  initial?: Partial<ResourceDescriptor>,
): ProviderHarness {
  let calls = 0
  let descriptor: Partial<ResourceDescriptor> = initial ?? {}
  return {
    provider: {
      id: 'provider-1',
      kind,
      resolve: async ref => {
        calls += 1
        return { ...ref, ...descriptor }
      },
      open() {
        throw new Error('本测试未预期 open')
      },
    },
    resolveCalls: () => calls,
    setDescriptor(next) {
      descriptor = next
    },
  }
}

describe('ResourceRuntimeService', () => {
  it('重复 kind 注册抛错，注销后可重注册', () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx)
    const harness = countingProvider('file')
    const dispose = runtime.registerProvider(harness.provider)
    expect(() => runtime.registerProvider({ ...harness.provider, id: 'other' })).toThrow(
      /重复注册/,
    )
    dispose()
    expect(() =>
      runtime.registerProvider({ ...harness.provider, id: 'other' }),
    ).not.toThrow()
  })

  it('describe 命中缓存只 resolve 一次', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx)
    const harness = countingProvider('file')
    runtime.registerProvider(harness.provider)
    const first = await runtime.describe('file', 'a')
    const second = await runtime.describe('file', 'a')
    expect(first).toEqual(second)
    expect(harness.resolveCalls()).toBe(1)
  })

  it('TTL 过期后重新 resolve', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx, { ttlMs: 10 })
    const harness = countingProvider('file', { size: 7 })
    runtime.registerProvider(harness.provider)
    await runtime.describe('file', 'a')
    await sleep(25)
    await runtime.describe('file', 'a')
    expect(harness.resolveCalls()).toBe(2)
  })

  it('provider 注销后缓存失效且 describe 抛错', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx)
    const harness = countingProvider('file')
    const dispose = runtime.registerProvider(harness.provider)
    await runtime.describe('file', 'a')
    dispose()
    await expect(runtime.describe('file', 'a')).rejects.toThrow(/未注册/)
  })

  it('describe best-effort 落库并覆盖旧值', async () => {
    const target = await createTestDb()
    try {
      const ctx = createContext()
      const runtime = new ResourceRuntimeService(ctx, { ttlMs: 0, db: target.db })
      const harness = countingProvider('file', { mime: 'text/plain' })
      runtime.registerProvider(harness.provider)
      const repository = new ResourceRepository(target.db)
      await runtime.describe('file', 'doc.txt')
      await expect(repository.find('file', 'doc.txt')).resolves.toMatchObject({
        kind: 'file',
        ref: 'doc.txt',
        mime: 'text/plain',
      })
      harness.setDescriptor({ mime: 'application/json' })
      await runtime.describe('file', 'doc.txt')
      await expect(repository.find('file', 'doc.txt')).resolves.toMatchObject({
        mime: 'application/json',
      })
    } finally {
      await target.destroy()
    }
  })

  it('容量上限按插入序淘汰', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx, { capacity: 1 })
    const harness = countingProvider('file')
    runtime.registerProvider(harness.provider)
    await runtime.describe('file', 'a')
    await runtime.describe('file', 'b')
    expect(harness.resolveCalls()).toBe(2)
    // a 被淘汰，再次 describe 需要第三次 resolve。
    await runtime.describe('file', 'a')
    expect(harness.resolveCalls()).toBe(3)
  })

  it('open 登记进 scope 且 close 中断流', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx)
    let openSignals: AbortSignal[] = []
    runtime.registerProvider({
      id: 'p',
      kind: 'file',
      resolve: async ref => ({ ...ref }),
      open(_descriptor, options) {
        if (options?.signal !== undefined) openSignals.push(options.signal)
        const iterator: AsyncIterator<Uint8Array> = {
          next: async () => {
            if (options?.signal?.aborted === true) {
              return { done: true as const, value: undefined }
            }
            await sleep(15)
            return { done: false as const, value: new Uint8Array([1, 2]) }
          },
        }
        return { [Symbol.asyncIterator]: () => iterator }
      },
    })
    const scope = new ResourceScope()
    const handle = await runtime.open(scope, 'file', 'stream.bin')
    const iterator = handle.stream[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(openSignals).toHaveLength(1)
    await scope.close()
    expect(scope.closed).toBe(true)
    const second = await iterator.next()
    expect(second.done).toBe(true)
    handle.release()
    handle.release()
  })

  it('外层 signal abort 联动流终止', async () => {
    const ctx = createContext()
    const runtime = new ResourceRuntimeService(ctx)
    const controller = new AbortController()
    let observedAborted = false
    runtime.registerProvider({
      id: 'p',
      kind: 'file',
      resolve: async ref => ({ ...ref }),
      open(_descriptor, options) {
        const iterator: AsyncIterator<Uint8Array> = {
          next: async () => {
            await sleep(20)
            observedAborted = options?.signal?.aborted === true
            return { done: false as const, value: new Uint8Array([9]) }
          },
        }
        return { [Symbol.asyncIterator]: () => iterator }
      },
    })
    const scope = new ResourceScope()
    const handle = await runtime.open(scope, 'file', 'r', { signal: controller.signal })
    const iterator = handle.stream[Symbol.asyncIterator]()
    controller.abort()
    await iterator.next()
    expect(observedAborted).toBe(true)
    await iterator.return?.(undefined)
  })
})
