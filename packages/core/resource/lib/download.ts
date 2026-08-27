import { RangeUnsupportedError } from '@delta-comic/protocol'
/**
 * DownloadService：下载任务编排（断点续传 / 校验 / 并发泵）。
 *
 * - 状态机 queued -> running -> completed|failed，中途可 paused/cancelled
 * - 续传以 sink.probe 为准；provider 不支持 Range 时整段重传一次
 * - 从头取回才校验 checksum（流式摘要只覆盖增量字节），大小始终校验
 * - 每次状态跃迁持久化并广播；进度变化仅通知订阅者
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Service, type Context } from 'cordis'

import { DownloadTaskRepository, type StoredDownloadTask } from './repository'
import type { ResourceHandle, ResourceRuntimeService } from './runtime'
import { ResourceScope } from './scope'

export type DownloadStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export const TERMINAL_STATUSES: readonly DownloadStatus[] = ['completed', 'failed', 'cancelled']

export interface DownloadSnapshot {
  readonly id: string
  readonly kind: string
  readonly ref: string
  readonly destKey: string
  readonly status: DownloadStatus
  readonly receivedBytes: number
  readonly totalBytes?: number
  readonly error?: string
}

/** 流式摘要计算器。 */
export interface DigestStream {
  update(chunk: Uint8Array): void
  digestHex(): string
}

/**
 * 下载落地抽象：destKey 由调用方自决（路径/缓存键均可）。
 * probe 返回已持久化字节数，作为续传偏移。
 */
export interface DownloadSink {
  probe(destKey: string): Promise<number>
  append(destKey: string, offset: number, chunk: Uint8Array): Promise<void>
  reset(destKey: string): Promise<void>
  finalize(destKey: string): Promise<void>
  remove(destKey: string): Promise<void>
}

export class ChecksumMismatchError extends Error {
  constructor(
    readonly algorithm: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`校验和不符（${algorithm}）：期望 ${expected}，实际 ${actual}`)
    this.name = 'ChecksumMismatchError'
  }
}

const defaultHashers: Readonly<Record<string, () => DigestStream>> = {
  sha256: () => {
    const hash = sha256.create()
    return { update: chunk => hash.update(chunk), digestHex: () => bytesToHex(hash.digest()) }
  },
}

export interface DownloadServiceDeps {
  readonly tasks: DownloadTaskRepository
  readonly sink: DownloadSink
  readonly runtime: ResourceRuntimeService
  /** 校验算法表；缺省提供 sha256。 */
  readonly hashers?: Readonly<Record<string, () => DigestStream>>
  /** 同时传输任务数上限；默认 2。 */
  readonly concurrency?: number
}

interface InternalTask {
  id: string
  kind: string
  ref: string
  destKey: string
  status: DownloadStatus
  receivedBytes: number
  totalBytes?: number
  error?: string
  controller?: AbortController
}

export class DownloadService extends Service {
  private readonly deps: DownloadServiceDeps
  private readonly hashers: Readonly<Record<string, () => DigestStream>>
  private readonly concurrency: number
  private readonly taskById = new Map<string, InternalTask>()
  private readonly listeners = new Set<() => void>()

  constructor(ctx: Context, deps: DownloadServiceDeps) {
    super(ctx, 'downloads')
    this.deps = deps
    this.hashers = deps.hashers ?? defaultHashers
    this.concurrency = Math.max(1, deps.concurrency ?? 2)
  }

  /** 当前全部任务快照。 */
  snapshots(): readonly DownloadSnapshot[] {
    return [...this.taskById.values()].map(toSnapshot)
  }

  /** 订阅任意变更（含进度）；返回退订函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 新建任务并入队；同 id 活跃任务存在时抛错。 */
  async enqueue(id: string, kind: string, ref: string, destKey: string): Promise<void> {
    const existing = this.taskById.get(id)
    if (existing !== undefined && !TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`下载任务已存在：${id}`)
    }
    const task: InternalTask = { id, kind, ref, destKey, status: 'queued', receivedBytes: 0 }
    this.taskById.set(id, task)
    await this.deps.tasks.insert(toStored(task))
    this.notifyAndEmit(task)
    this.pump()
  }

  /** 暂停：running 先改状态再中断流，queued 直接跃迁。 */
  async pause(id: string): Promise<void> {
    const task = this.requireActive(id)
    if (task.status !== 'running' && task.status !== 'queued') {
      throw new Error(`任务 ${id} 处于 ${task.status}，无法暂停`)
    }
    this.transition(task, 'paused')
    task.controller?.abort()
    this.pump()
  }

  /** 恢复：paused 回到队列重新泵。 */
  async resume(id: string): Promise<void> {
    const task = this.requireActive(id)
    if (task.status !== 'paused') throw new Error(`任务 ${id} 处于 ${task.status}，无法恢复`)
    this.transition(task, 'queued')
    this.pump()
  }

  /** 取消：终态化并中断进行中的流。 */
  async cancel(id: string): Promise<void> {
    const task = this.requireActive(id)
    if (TERMINAL_STATUSES.includes(task.status)) {
      throw new Error(`任务 ${id} 已处于终态 ${task.status}`)
    }
    this.transition(task, 'cancelled')
    task.controller?.abort()
    this.pump()
  }

  /** 重试：failed/cancelled 回到队列，续传点由 sink 决定。 */
  async retry(id: string): Promise<void> {
    const task = this.taskById.get(id)
    if (task === undefined || (task.status !== 'failed' && task.status !== 'cancelled')) {
      throw new Error(`任务 ${id} 不在可重试状态`)
    }
    task.error = undefined
    this.transition(task, 'queued')
    this.pump()
  }

  /** 移除任务与落地数据；进行中的任务先中断。 */
  async remove(id: string): Promise<void> {
    const task = this.taskById.get(id)
    if (task === undefined) throw new Error(`下载任务不存在：${id}`)
    task.controller?.abort()
    this.taskById.delete(id)
    await this.deps.tasks.remove(id)
    await this.deps.sink.remove(task.destKey)
    this.notifyAndEmit(task)
  }

  /** 重启恢复：把仓库里遗留的 running 任务拉回队列并重泵。 */
  async recoverStale(): Promise<void> {
    const rows = await this.deps.tasks.list()
    for (const row of rows) {
      if (row.status !== 'running' || this.taskById.has(row.id)) continue
      const task: InternalTask = {
        id: row.id,
        kind: row.kind,
        ref: row.ref,
        destKey: row.destKey,
        status: 'queued',
        receivedBytes: row.receivedBytes,
        totalBytes: row.totalBytes,
      }
      this.taskById.set(row.id, task)
      await this.deps.tasks.update(row.id, { status: 'queued', receivedBytes: row.receivedBytes })
      this.notifyAndEmit(task)
    }
    this.pump()
  }

  private requireActive(id: string): InternalTask {
    const task = this.taskById.get(id)
    if (task === undefined) throw new Error(`下载任务不存在：${id}`)
    return task
  }

  private pump(): void {
    const running = [...this.taskById.values()].filter(task => task.status === 'running').length
    let slots = this.concurrency - running
    if (slots <= 0) return
    for (const task of this.taskById.values()) {
      if (slots <= 0) break
      if (task.status !== 'queued') continue
      slots -= 1
      void this.runTask(task)
    }
  }

  private async runTask(task: InternalTask): Promise<void> {
    const controller = new AbortController()
    task.controller = controller
    this.transition(task, 'running')
    const scope = new ResourceScope()
    let received = task.receivedBytes
    try {
      let resumedFrom = await this.deps.sink.probe(task.destKey)
      let attempt = 0
      let handle: ResourceHandle | undefined
      let hasher = nullDigest
      // 仅当本次尝试从头取回完整主体时才可信 checksum；
      // 续传尝试的流式摘要只覆盖增量字节，交由 expectedSize 兜底。
      let fromZero = false
      for (;;) {
        attempt += 1
        fromZero = resumedFrom === 0
        let appendedAny = false
        try {
          handle = await this.deps.runtime.open(scope, task.kind, task.ref, {
            signal: controller.signal,
            offset: resumedFrom > 0 ? resumedFrom : undefined,
          })
          if (handle.descriptor.size !== undefined) task.totalBytes = handle.descriptor.size
          received = resumedFrom
          hasher = this.createDigest(handle.descriptor.checksum?.algorithm)
          for await (const chunk of handle.stream) {
            appendedAny = true
            hasher.update(chunk)
            await this.deps.sink.append(task.destKey, received, chunk)
            received += chunk.byteLength
            task.receivedBytes = received
            this.notify()
          }
        } catch (error) {
          const retriableRange =
            error instanceof RangeUnsupportedError && !appendedAny && attempt === 1
          if (!retriableRange) throw error
          // 首次尝试即拒绝 Range：清空重来一次。
          await this.deps.sink.reset(task.destKey)
          resumedFrom = 0
          continue
        } finally {
          handle?.release()
        }
        break
      }
      if (controller.signal.aborted) {
        if (task.status === 'paused' || task.status === 'cancelled') return
        throw new Error('下载流被外部中断')
      }
      // 任务已被 remove 移出表内，静默收尾。
      if (this.taskById.get(task.id) !== task) return
      this.validate(
        handle?.descriptor.size,
        received,
        hasher,
        fromZero ? handle?.descriptor.checksum : undefined,
      )
      await this.deps.sink.finalize(task.destKey)
      this.transition(task, 'completed')
    } catch (error) {
      if (task.status === 'paused' || task.status === 'cancelled') return
      task.error = errorMessage(error)
      this.transition(task, 'failed')
    } finally {
      // 重泵竞态下新 runTask 可能已接管 controller，仅清理属于自己的。
      if (task.controller === controller) task.controller = undefined
      await scope.close()
      this.pump()
    }
  }

  private createDigest(algorithm: string | undefined): DigestStream {
    if (algorithm === undefined) return nullDigest
    const factory = this.hashers[algorithm]
    if (factory === undefined) throw new Error(`未注册的校验算法：${algorithm}`)
    return factory()
  }

  private validate(
    expectedSize: number | undefined,
    received: number,
    hasher: DigestStream,
    checksum: { algorithm: string; digest: string } | undefined,
  ): void {
    if (expectedSize !== undefined && received !== expectedSize) {
      throw new Error(`下载大小不符：期望 ${expectedSize}，实际 ${received}`)
    }
    const digest = hasher.digestHex()
    if (checksum !== undefined && digest.length > 0 && digest !== checksum.digest) {
      throw new ChecksumMismatchError(checksum.algorithm, checksum.digest, digest)
    }
  }

  private transition(task: InternalTask, status: DownloadStatus): void {
    task.status = status
    if (status !== 'failed') task.error = undefined
    this.persistTransition(task).catch(reason => {
      this.ctx.logger.error('下载任务 %s 状态持久化失败：%s', task.id, errorMessage(reason))
    })
    this.notifyAndEmit(task)
  }

  private async persistTransition(task: InternalTask): Promise<void> {
    await this.deps.tasks.update(task.id, {
      status: task.status,
      receivedBytes: task.receivedBytes,
      totalBytes: task.totalBytes,
      error: task.error,
    })
  }

  private notifyAndEmit(task: InternalTask): void {
    this.ctx.emit('download/task-changed', toSnapshot(task))
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

function toSnapshot(task: InternalTask): DownloadSnapshot {
  return {
    id: task.id,
    kind: task.kind,
    ref: task.ref,
    destKey: task.destKey,
    status: task.status,
    receivedBytes: task.receivedBytes,
    totalBytes: task.totalBytes,
    error: task.error,
  }
}

function toStored(task: InternalTask): StoredDownloadTask {
  return {
    id: task.id,
    kind: task.kind,
    ref: task.ref,
    destKey: task.destKey,
    status: task.status,
    receivedBytes: task.receivedBytes,
    totalBytes: task.totalBytes,
    error: task.error,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

const nullDigest: DigestStream = { update: () => {}, digestHex: () => '' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

declare module 'cordis' {
  interface Context {
    downloads: DownloadService
  }

  interface Events {
    /** 下载任务状态跃迁广播。 @mode emit */
    'download/task-changed'(task: DownloadSnapshot): void
  }
}