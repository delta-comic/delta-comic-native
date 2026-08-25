import {
  isUIOverrideRegistration,
  isValidUiKey,
  type UIRegistry,
  type UIRegistration,
} from '@delta-comic/protocol'
/**
 * UIRegistryService：类型化 UI 注册表。
 *
 * - get<K> 按 augmentation 声明的组件类型返回
 * - 覆盖必须显式声明 targetId 与 compatibleVersion，且优先级高于目标
 */
import { Service, type Context, type Disposable } from 'cordis'
import { satisfies, valid } from 'semver'

interface UIEntry {
  readonly id: string
  readonly version: string
  readonly priority: number
  resolve(): unknown
}

/** 注册表投影条目（调试通道 registry_list 数据源），不含组件引用。 */
export interface UIRegistryEntryProjection {
  readonly key: string
  readonly items: readonly { id: string; version: string; priority: number }[]
}

export class UIRegistryService extends Service {
  private readonly buckets = new Map<string, Map<string, UIEntry>>()

  constructor(ctx: Context) {
    super(ctx, 'uiRegistry')
  }

  /** 返回该 key 下当前优先级最高的组件。 */
  get<K extends keyof UIRegistry>(key: K): UIRegistry[K] {
    const bucket = this.buckets.get(key)
    if (bucket === undefined || bucket.size === 0) {
      throw new Error(`UI 注册项不存在：${String(key)}`)
    }
    let best: UIEntry | undefined
    for (const entry of bucket.values()) {
      if (best === undefined || entry.priority > best.priority) best = entry
    }
    if (best === undefined) throw new Error(`UI 注册项不存在：${String(key)}`)
    // 异构容器的存在类型边界：component 的匹配关系由 register<K> 签名静态保证，
    // 存储层擦除 K 后此处是唯一还原点。
    return best.resolve() as UIRegistry[K]
  }

  /** 注册或覆盖一个分层 key；返回注销 disposer。 */
  register<K extends keyof UIRegistry>(
    key: K,
    registration: UIRegistration<UIRegistry[K]>,
  ): Disposable {
    if (!isValidUiKey(key)) throw new TypeError(`非法分层 key：${String(key)}`)
    if (!valid(registration.version)) {
      throw new TypeError(`注册版本不是合法 semver：${registration.version}`)
    }
    let bucket = this.buckets.get(key)
    if (bucket === undefined) {
      bucket = new Map()
      this.buckets.set(key, bucket)
    }
    if (bucket.has(registration.id)) {
      throw new Error(`UI 注册项重复：${key}/${registration.id}`)
    }
    const priority = registration.priority ?? 0
    if (isUIOverrideRegistration(registration)) {
      const target = bucket.get(registration.override.targetId)
      if (target === undefined) {
        throw new Error(`override 目标不存在：${key}/${registration.override.targetId}`)
      }
      if (!satisfies(target.version, registration.override.compatibleVersion)) {
        throw new Error(
          `override 兼容范围不满足：目标 ${target.version} 不在 ${registration.override.compatibleVersion} 内`,
        )
      }
      if (priority <= target.priority) {
        throw new Error(`override 优先级（${priority}）必须高于目标（${target.priority}）`)
      }
    }
    const entry: UIEntry = {
      id: registration.id,
      version: registration.version,
      priority,
      resolve: () => registration.component,
    }
    bucket.set(registration.id, entry)
    return () => {
      const current = this.buckets.get(key)
      if (current === undefined) return
      current.delete(registration.id)
      if (current.size === 0) this.buckets.delete(key)
    }
  }

  /** 全部注册项的只读投影，key 按 Map 插入顺序排列。 */
  entries(): readonly UIRegistryEntryProjection[] {
    return [...this.buckets.entries()].map(([key, bucket]) => ({
      key,
      items: [...bucket.values()].map(entry => ({
        id: entry.id,
        version: entry.version,
        priority: entry.priority,
      })),
    }))
  }
}

declare module 'cordis' {
  interface Context {
    uiRegistry: UIRegistryService
  }
}