import { Service } from 'cordis'
import type { Context, Disposable } from 'cordis'

/** 存储层类别：volatile 为易失缓存（可整层清理），persistent 为持久数据（仅显式删除）。 */
export type StorageKind = 'volatile' | 'persistent'

/** 存储对象元数据；key 层内唯一，平台绝对路径不经过本协议。 */
export interface StorageObject {
  readonly key: string
  readonly sizeBytes: number
  readonly lastAccessAt: number
}

/**
 * 存储层适配器：由宿主按平台实现（桌面/Android 文件目录、Web Cache 等），
 * 治理服务只面对元数据与删除操作。
 */
export interface StorageLayerAdapter {
  /** 层 id，全局唯一，如 'image-cache'。 */
  readonly id: string
  readonly kind: StorageKind
  list(): Promise<StorageObject[]>
  remove(key: string): Promise<void>
}

/** 单层用量统计。 */
export interface LayerUsage {
  readonly id: string
  readonly kind: StorageKind
  readonly objectCount: number
  readonly totalBytes: number
}

/** 全量用量报告，供"我的"页展示。 */
export interface StorageUsageReport {
  readonly layers: LayerUsage[]
  readonly totalBytes: number
}

/** 一次清理/驱逐的结果。 */
export interface EvictionResult {
  readonly layerId: string
  readonly removedCount: number
  readonly freedBytes: number
}

export interface StorageConfig {
  /** 按 kind 设置字节配额；缺省表示该 kind 不限额。 */
  quotas?: Partial<Record<StorageKind, number>>
}

interface LayerState {
  readonly adapter: StorageLayerAdapter
}

const KINDS: readonly StorageKind[] = ['volatile', 'persistent']

function isStorageKind(value: unknown): value is StorageKind {
  return value === 'volatile' || value === 'persistent'
}

/**
 * 存储治理服务：用量统计、易失层清理、限额配置与 LRU 驱逐。
 * 字节流本身经 resource/download 驱动流动，这里只做账目与策略。
 */
export class StorageService extends Service {
  private readonly layers = new Map<string, LayerState>()
  private quotas: Partial<Record<StorageKind, number>>

  constructor(ctx: Context, config: StorageConfig = {}) {
    const quotas = validateQuotas(config.quotas)
    super(ctx, 'storage')
    this.quotas = quotas
  }

  /** 注册存储层；id 重复抛错。返回注销 disposer。 */
  registerLayer(adapter: StorageLayerAdapter): Disposable {
    if (!isStorageKind(adapter.kind)) throw new Error(`非法存储层 kind：${String(adapter.kind)}`)
    if (this.layers.has(adapter.id)) throw new Error(`存储层重复注册：${adapter.id}`)
    this.layers.set(adapter.id, { adapter })
    this.ctx.emit('storage/usage-changed', null)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.layers.get(adapter.id)?.adapter === adapter) {
        this.layers.delete(adapter.id)
        this.ctx.emit('storage/usage-changed', null)
      }
    }
  }

  /** 聚合各层用量。 */
  async usage(): Promise<StorageUsageReport> {
    const report: LayerUsage[] = []
    let totalBytes = 0
    for (const { adapter } of this.layers.values()) {
      const objects = await adapter.list()
      const total = objects.reduce((sum, object) => sum + object.sizeBytes, 0)
      report.push({
        id: adapter.id,
        kind: adapter.kind,
        objectCount: objects.length,
        totalBytes: total,
      })
      totalBytes += total
    }
    return { layers: report, totalBytes }
  }

  /**
   * 清理易失缓存：不传 layerId 时清空全部 volatile 层。
   * persistent 层仅支持显式逐对象删除，此处传入即抛错。
   */
  async clearCache(layerId?: string): Promise<EvictionResult[]> {
    const targets = this.selectVolatile(layerId)
    const results: EvictionResult[] = []
    for (const { adapter } of targets) {
      results.push(await evictAll(adapter))
    }
    if (results.length > 0) this.ctx.emit('storage/usage-changed', null)
    return results
  }

  /**
   * 执行配额检查：对超出限额的 volatile 层按 lastAccessAt 从旧到新驱逐至限额内。
   * persistent 层不受配额约束；不传 layerId 时检查全部 volatile 层。
   */
  async enforce(layerId?: string): Promise<EvictionResult[]> {
    const targets = this.selectVolatile(layerId)
    const results: EvictionResult[] = []
    for (const { adapter } of targets) {
      const quota = this.quotas[adapter.kind]
      if (quota === undefined) continue
      results.push(await enforceQuota(adapter, quota))
    }
    if (results.some(result => result.removedCount > 0)) {
      this.ctx.emit('storage/usage-changed', null)
    }
    return results
  }

  /** 读取某 kind 的字节配额；未设置返回 undefined。 */
  quotaOf(kind: StorageKind): number | undefined {
    return this.quotas[kind]
  }

  /** 动态调整配额；maxBytes 为 null 表示取消限额。 */
  setQuota(kind: StorageKind, maxBytes: number | null): void {
    if (maxBytes === null) {
      delete this.quotas[kind]
      return
    }
    const validated = validateQuotas({ [kind]: maxBytes })
    this.quotas[kind] = validated[kind]
  }

  private selectVolatile(layerId?: string): Array<LayerState> {
    if (layerId === undefined) {
      return [...this.layers.values()].filter(layer => layer.adapter.kind === 'volatile')
    }
    const layer = this.layers.get(layerId)
    if (layer === undefined) throw new Error(`存储层未注册：${layerId}`)
    if (layer.adapter.kind !== 'volatile') {
      throw new Error(`持久层不支持 clearCache/enforce：${layerId}`)
    }
    return [layer]
  }
}

declare module 'cordis' {
  interface Context {
    storage: StorageService
  }

  interface Events {
    /** 存储用量变化广播（注册/注销/清理/驱逐后触发）；负载预留扩展位。 @mode emit */
    'storage/usage-changed'(scope: null): void
  }
}

async function evictAll(adapter: StorageLayerAdapter): Promise<EvictionResult> {
  const objects = await adapter.list()
  let freedBytes = 0
  for (const object of objects) {
    await adapter.remove(object.key)
    freedBytes += object.sizeBytes
  }
  return { layerId: adapter.id, removedCount: objects.length, freedBytes }
}

async function enforceQuota(adapter: StorageLayerAdapter, quota: number): Promise<EvictionResult> {
  const objects = [...(await adapter.list())].sort((a, b) => a.lastAccessAt - b.lastAccessAt)
  let total = objects.reduce((sum, object) => sum + object.sizeBytes, 0)
  let removedCount = 0
  let freedBytes = 0
  for (const object of objects) {
    if (total <= quota) break
    await adapter.remove(object.key)
    total -= object.sizeBytes
    removedCount++
    freedBytes += object.sizeBytes
  }
  return { layerId: adapter.id, removedCount, freedBytes }
}

function validateQuotas(quotas: StorageConfig['quotas']): Partial<Record<StorageKind, number>> {
  const validated: Partial<Record<StorageKind, number>> = {}
  for (const kind of KINDS) {
    const value = quotas?.[kind]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`非法存储配额 ${kind}: ${value}`)
    }
    validated[kind] = value
  }
  return validated
}