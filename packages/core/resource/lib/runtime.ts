/**
 * ResourceRuntimeService：provider 注册表 + describe/open 运行时。
 *
 * - registerProvider 按 kind 全局唯一，重复注册抛错
 * - describe 结果带 TTL 与容量上限缓存，并 best-effort 落库到 ResourceRepository
 * - open 产出 ResourceHandle，租约登记进 scope；scope close 时 abort 流并释放
 */
import type { CoreDatabase } from '@delta-comic/db'
import type {
  ResourceDescriptor,
  ResourceOpenOptions,
  ResourceProvider,
} from '@delta-comic/protocol'
import { Service, type Context, type Disposable } from 'cordis'
import type { Kysely } from 'kysely'

import { ResourceRepository } from './repository'
import type { ResourceScope } from './scope'

export interface ResourceHandle {
  readonly descriptor: ResourceDescriptor
  readonly stream: AsyncIterable<Uint8Array>
  release(): void
}

interface CacheEntry {
  readonly descriptor: ResourceDescriptor
  readonly expiresAt: number
}

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_CAPACITY = 512

export interface ResourceRuntimeOptions {
  /** 描述缓存 TTL，毫秒；默认 5 分钟。 */
  readonly ttlMs?: number
  /** 描述缓存容量上限，超出按插入序淘汰；默认 512。 */
  readonly capacity?: number
  /** 可选持久化仓库；提供时 describe 结果 best-effort 落库。 */
  readonly db?: Kysely<CoreDatabase>
}

export class ResourceRuntimeService extends Service {
  private readonly providersByKind = new Map<string, ResourceProvider>()
  private readonly cache = new Map<string, CacheEntry>()
  private readonly repository?: ResourceRepository
  private readonly ttlMs: number
  private readonly capacity: number

  constructor(ctx: Context, options?: ResourceRuntimeOptions) {
    super(ctx, 'resources')
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
    this.capacity = options?.capacity ?? DEFAULT_CAPACITY
    if (options?.db !== undefined) this.repository = new ResourceRepository(options.db)
  }

  /** 注册资源 provider；kind 重复注册抛错。返回注销 disposer。 */
  registerProvider(provider: ResourceProvider): Disposable {
    if (this.providersByKind.has(provider.kind)) {
      throw new Error(`ResourceProvider kind 重复注册：${provider.kind}`)
    }
    this.providersByKind.set(provider.kind, provider)
    return () => {
      this.providersByKind.delete(provider.kind)
      for (const [key, entry] of this.cache) {
        if (entry.descriptor.kind === provider.kind) this.cache.delete(key)
      }
    }
  }

  /** 归一化描述：命中缓存直接返回，否则 resolve 并回填缓存与仓库。 */
  async describe(kind: string, ref: string): Promise<ResourceDescriptor> {
    const cached = this.cache.get(cacheKey(kind, ref))
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.descriptor
    const descriptor = await this.requireProvider(kind).resolve({ kind, ref })
    return await this.cacheDescriptor(descriptor)
  }

  /** 打开字节流：descriptor 解析后 open，租约与 abort 登记进 scope。 */
  async open(
    scope: ResourceScope,
    kind: string,
    ref: string,
    options?: ResourceOpenOptions,
  ): Promise<ResourceHandle> {
    const provider = this.requireProvider(kind)
    const descriptor = await this.describe(kind, ref)
    const controller = new AbortController()
    const lease = scope.acquire(`open:${kind}\u0000${ref}`)
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      controller.abort()
      lease.release()
    }
    scope.onClose(release)
    const signal = options?.signal
    signal?.addEventListener('abort', () => controller.abort(), { once: true })
    const stream = provider.open(descriptor, { ...options, signal: controller.signal })
    return { descriptor, stream: guardStream(stream, controller, signal), release }
  }

  private requireProvider(kind: string): ResourceProvider {
    const provider = this.providersByKind.get(kind)
    if (provider === undefined) throw new Error(`ResourceProvider 未注册：${kind}`)
    return provider
  }

  private async cacheDescriptor(descriptor: ResourceDescriptor): Promise<ResourceDescriptor> {
    const key = cacheKey(descriptor.kind, descriptor.ref)
    this.cache.set(key, { descriptor, expiresAt: Date.now() + this.ttlMs })
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next()
      if (oldest.done === true) break
      this.cache.delete(oldest.value)
    }
    this.ctx.emit('resource/described', descriptor)
    if (this.repository !== undefined) {
      try {
        await this.repository.upsert(descriptor)
      } catch {
        // 仓库落库为 best-effort，失败不阻断运行时路径。
      }
    }
    return descriptor
  }
}

function cacheKey(kind: string, ref: string): string {
  return `${kind}\u0000${ref}`
}

/** 包装字节流：中断后提前结束迭代，外层 signal 触发时联动 abort。 */
function guardStream(
  stream: AsyncIterable<Uint8Array>,
  controller: AbortController,
  outer: AbortSignal | undefined,
): AsyncIterable<Uint8Array> {
  const internal = controller.signal
  const onOuterAbort = (): void => controller.abort()
  outer?.addEventListener('abort', onOuterAbort, { once: true })
  return {
    [Symbol.asyncIterator]: () => {
      const iterator = stream[Symbol.asyncIterator]()
      return {
        next: async () => {
          try {
            return await iterator.next()
          } finally {
            if (internal.aborted) {
              outer?.removeEventListener('abort', onOuterAbort)
              await iterator.return?.(undefined)
              return { done: true as const, value: undefined }
            }
          }
        },
        return: async value => {
          outer?.removeEventListener('abort', onOuterAbort)
          controller.abort()
          const stop = iterator.return?.call(iterator, value)
          if (stop !== undefined) return await stop
          return { done: true as const, value: undefined }
        },
      }
    },
  }
}

declare module 'cordis' {
  interface Context {
    resources: ResourceRuntimeService
  }

  interface Events {
    /** 资源描述缓存回填广播（每次 resolve 后触发）。 @mode emit */
    'resource/described'(descriptor: ResourceDescriptor): void
  }
}
