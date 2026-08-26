/**
 * EdgeRouter：多端点竞速选路与故障转移服务（architecture.md §8.2）。
 *
 * - 每个启用 network.multiEdge 的插件独立一份状态机
 *   unprobed → probing → ready(selected) / failed(全灭)
 * - 探测 = 并发轻量 GET 竞速，首个成功即 selected，其余出结果后记录 latency 排序
 * - 冷启动 last_ok_at 在 TTL 内直接复用选中免探；failed 按 30s→2m→5m 退避重探
 * - 插件 API 面：current / ensureSelected / resolve / report / withFailover
 * - 选中变更广播 protocol/edge-changed {pluginId, edge}
 */
import type { Edge, ResolveEdgesHook } from '@delta-comic/protocol'
import { Service, type Context, type Disposable } from 'cordis'
import type { Kysely } from 'kysely'

import { createHttpProber, type Prober, type RankedEndpoint } from './probe'
import { EndpointRepository, type EndpointDb, type EndpointRecord } from './repository'

/** 单插件探测超时（轻量 GET）。 */
export const PROBE_TIMEOUT_MS = 5000

/** ensureSelected 兜底超时。 */
export const ENSURE_SELECTED_TIMEOUT_MS = 8000

/** 冷启动复用窗口：last_ok_at 在此 TTL 内的端点免探直用。 */
export const ENDPOINT_REUSE_TTL_MS = 6 * 60 * 60 * 1000

/** failed 状态的退避档位，超出后停在最后一档。 */
export const BACKOFF_STEPS_MS = [30_000, 120_000, 300_000] as const

export type EdgeStatus = 'unprobed' | 'probing' | 'ready' | 'failed'

/** ensureSelected 在全灭/超时/未附加时抛出的结构化错误，UI 据此呈现恢复界面。 */
export class NoEdgeAvailableError extends Error {
  override readonly name = 'NoEdgeAvailableError'

  readonly code = 'no-edge-available'

  constructor(
    readonly pluginId: string,
    options?: { cause?: unknown },
  ) {
    super(`插件无可用端点：${pluginId}`, options)
  }
}

/** 候选端点只读投影（诊断导出与恢复界面数据源）。 */
export interface EndpointView {
  readonly url: string
  readonly label?: string
  readonly latencyMs: number
  readonly failCount: number
}

/** 单插件路由快照（§10 诊断导出的状态机投影）。 */
export interface EdgeRouterSnapshot {
  readonly pluginId: string
  readonly version: string
  readonly status: EdgeStatus
  readonly selected: Edge | null
  readonly candidates: readonly EndpointView[]
  readonly lastError?: string
}

export interface AttachOptions {
  /** 分层 key 形态的插件 id。 */
  readonly pluginId: string
  /** 触发重探的版本标识；宿主在插件更新后以新 version 重新 attach 即可。 */
  readonly version: string
  /** resolveEdges hook 的加载上下文（契约要求传入该插件的 Cordis ctx）。 */
  readonly pluginContext: Context
  /** 运行时产出端点候选的 hook。 */
  readonly resolveEdges: ResolveEdgesHook
}

export interface EdgeRouterOptions {
  /** 覆盖默认 HTTP 探测器（测试注入）。 */
  readonly prober?: Prober
}

interface RouterState {
  pluginId: string
  version: string
  pluginContext: Context
  resolveEdges: ResolveEdgesHook
  status: EdgeStatus
  selected: Edge | null
  ranking: RankedEndpoint[]
  failCount: number
  backoffStep: number
  probing: Promise<void> | null
  hydration: Promise<void>
  backoffTimer: ReturnType<typeof setTimeout> | null
  lastError?: unknown
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

function dedupeEdges(edges: readonly Edge[]): Edge[] {
  const byUrl = new Map<string, Edge>()
  for (const edge of edges) {
    const baseUrl = normalizeBaseUrl(edge.baseUrl)
    if (!byUrl.has(baseUrl)) byUrl.set(baseUrl, { ...edge, baseUrl })
  }
  return [...byUrl.values()]
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, pluginId: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const gate = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new NoEdgeAvailableError(pluginId)), timeoutMs)
  })
  return Promise.race([promise, gate]).finally(() => clearTimeout(timer))
}

const toIso = (epochMs: number): string => new Date(epochMs).toISOString()

const edgeOf = (record: EndpointRecord): Edge => ({
  baseUrl: record.url,
  label: record.label ?? undefined,
})

const describeCause = (cause: unknown): string | undefined => {
  if (cause === undefined) return undefined
  if (cause instanceof Error) return cause.message
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch {
    return '[unserializable]'
  }
}

export class EdgeRouterService extends Service {
  private readonly states = new Map<string, RouterState>()
  private readonly repo: EndpointRepository
  private readonly prober: Prober

  constructor(ctx: Context, db: Kysely<EndpointDb>, options?: EdgeRouterOptions) {
    super(ctx, 'edgeRouter')
    this.repo = new EndpointRepository(db)
    this.prober = options?.prober ?? createHttpProber()
  }

  /**
   * 登记一个 multiEdge 插件并执行冷启动判定：
   * 持久化行存在 TTL 内的成功记录则免探复用，否则保持 unprobed 待按需探测。
   * 返回注销 disposer（loader 卸载/更新该插件时调用）。
   */
  attach(options: AttachOptions): Disposable {
    if (this.states.has(options.pluginId)) {
      throw new Error(`EdgeRouter 重复附加：${options.pluginId}`)
    }
    const state: RouterState = {
      pluginId: options.pluginId,
      version: options.version,
      pluginContext: options.pluginContext,
      resolveEdges: options.resolveEdges,
      status: 'unprobed',
      selected: null,
      ranking: [],
      failCount: 0,
      backoffStep: 0,
      probing: null,
      hydration: Promise.resolve(),
      backoffTimer: null,
    }
    state.hydration = this.hydrate(state)
    this.states.set(options.pluginId, state)
    return () => this.detach(options.pluginId)
  }

  /** 移除插件路由状态并广播 null（消费者停止引用该插件端点）。 */
  detach(pluginId: string): void {
    const state = this.states.get(pluginId)
    if (state === undefined) return
    if (state.backoffTimer !== null) clearTimeout(state.backoffTimer)
    this.states.delete(pluginId)
    this.emitChanged(pluginId, null)
  }

  /** 同步读取当前选中端点；未就绪返回 null（渲染路径安全）。 */
  current(pluginId: string): Edge | null {
    return this.states.get(pluginId)?.selected ?? null
  }

  /**
   * 同步兜底：ready 直接返回缓存；unprobed 当场竞速；probing 等待在途探测；
   * failed 或超时抛 NoEdgeAvailableError。
   */
  async ensureSelected(pluginId: string, timeoutMs = ENSURE_SELECTED_TIMEOUT_MS): Promise<Edge> {
    const state = this.states.get(pluginId)
    if (state === undefined) throw new NoEdgeAvailableError(pluginId)
    if (state.status === 'ready' && state.selected !== null) return state.selected
    if (state.status === 'failed') {
      throw new NoEdgeAvailableError(pluginId, { cause: describeCause(state.lastError) })
    }
    const run = state.probing ?? this.probe(state)
    try {
      await raceWithTimeout(run, timeoutMs, pluginId)
    } catch (cause) {
      throw cause instanceof NoEdgeAvailableError
        ? cause
        : new NoEdgeAvailableError(pluginId, { cause })
    }
    if (state.status === 'ready' && state.selected !== null) return state.selected
    throw new NoEdgeAvailableError(pluginId, { cause: describeCause(state.lastError) })
  }

  /** 以当前选中端点补全资源路径；绝对 URL 原样返回。 */
  resolve(pluginId: string, path: string): string {
    if (/^https?:\/\//i.test(path)) return path
    const state = this.states.get(pluginId)
    if (state === undefined || state.selected === null) {
      throw new NoEdgeAvailableError(pluginId)
    }
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `${normalizeBaseUrl(state.selected.baseUrl)}${suffix}`
  }

  /**
   * 插件运行期回报：ok=true 刷新触达并清零失败计数；
   * ok=false 标记失败并在存在次优时切换选中。
   */
  report(pluginId: string, url: string, ok: boolean): void {
    const state = this.states.get(pluginId)
    if (state === undefined) return
    if (ok) {
      state.failCount = 0
      void this.repo.touch(pluginId, normalizeBaseUrl(url), toIso(Date.now())).catch(error => {
        this.log.error('触达落账失败：%s %o', url, error)
      })
      return
    }
    if (state.selected?.baseUrl !== normalizeBaseUrl(url)) return
    this.markFailure(state)
  }

  /**
   * 故障转移调用：回调抛错 → 标记当前端点 → 切换 latency 次优 → 重调一次；
   * 重试控制流（更多次数/退避）留在插件回调内。
   */
  async withFailover<T>(
    pluginId: string,
    fn: (edge: Edge) => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const edge = await this.ensureSelected(pluginId, timeoutMs)
    try {
      return await fn(edge)
    } catch (cause) {
      this.report(pluginId, edge.baseUrl, false)
      const next = this.current(pluginId)
      if (next !== null && next.baseUrl !== normalizeBaseUrl(edge.baseUrl)) return fn(next)
      throw cause
    }
  }

  /** 空闲预热入口（loader 激活完成后调度）；结果仅落账，不向调用方抛错。 */
  warmup(pluginId: string): Promise<Edge | null> {
    return this.ensureSelected(pluginId).catch(error => {
      if (!(error instanceof NoEdgeAvailableError)) {
        this.log.error('预热探测异常：%s %o', pluginId, error)
      }
      return null
    })
  }

  /** 手动触发重探（multiEdge 开关变化、用户刷新等）；返回在途或新起的探测。 */
  reprobe(pluginId: string): Promise<void> {
    const state = this.states.get(pluginId)
    if (state === undefined) return Promise.resolve()
    if (state.probing !== null) return state.probing
    if (state.backoffTimer !== null) {
      clearTimeout(state.backoffTimer)
      state.backoffTimer = null
    }
    return this.probe(state)
  }

  /** 全部已附加插件的状态机快照（诊断导出）。 */
  snapshot(): readonly EdgeRouterSnapshot[] {
    return [...this.states.values()].map(state => ({
      pluginId: state.pluginId,
      version: state.version,
      status: state.status,
      selected: state.selected,
      candidates: state.ranking.map(entry => ({
        url: entry.edge.baseUrl,
        label: entry.edge.label,
        latencyMs: entry.latencyMs,
        failCount: entry.edge.baseUrl === state.selected?.baseUrl ? state.failCount : 0,
      })),
      ...(state.lastError === undefined ? {} : { lastError: describeCause(state.lastError) }),
    }))
  }

  private get log() {
    return this.ctx.logger('edge-router')
  }

  /** 冷启动复用判定：TTL 内成功记录按 latency 取优，过期行清理。 */
  private async hydrate(state: RouterState): Promise<void> {
    let rows: EndpointRecord[]
    try {
      rows = await this.repo.listByPlugin(state.pluginId)
    } catch (error) {
      this.log.error('冷启动读取端点表失败：%s %o', state.pluginId, error)
      return
    }
    const now = Date.now()
    const fresh = rows
      .filter(row => row.lastOkAt !== null && now - row.lastOkAt <= ENDPOINT_REUSE_TTL_MS)
      .sort(
        (a, b) =>
          (a.latencyMs ?? Number.POSITIVE_INFINITY) - (b.latencyMs ?? Number.POSITIVE_INFINITY),
      )
    if (fresh.length > 0 && state.status === 'unprobed') {
      const ranking: RankedEndpoint[] = fresh.map(record => ({
        edge: edgeOf(record),
        latencyMs: record.latencyMs ?? 0,
      }))
      state.ranking = ranking
      state.selected = ranking[0]?.edge ?? null
      if (state.selected !== null) {
        state.status = 'ready'
        this.emitChanged(state.pluginId, state.selected)
      }
    }
    await this.repo.pruneStale(state.pluginId, toIso(now - ENDPOINT_REUSE_TTL_MS)).catch(error => {
      this.log.error('陈旧端点清理失败：%s %o', state.pluginId, error)
    })
  }

  /** 单飞探测：resolveEdges → 竞速 → 首胜即选中 → 全量排名落账。 */
  private probe(state: RouterState): Promise<void> {
    if (state.probing !== null) return state.probing
    const run = (async () => {
      await state.hydration.catch(() => {})
      state.status = 'probing'
      let edges: Edge[]
      try {
        edges = dedupeEdges(await state.resolveEdges(state.pluginContext))
      } catch (cause) {
        this.markFailed(state, cause)
        return
      }
      if (edges.length === 0) {
        this.markFailed(state, new Error('resolveEdges 未产出任何候选'))
        return
      }
      try {
        const race = this.prober(edges, { timeoutMs: PROBE_TIMEOUT_MS })
        const first = await race.whenFirst
        this.select(state, first)
        void race.whenSettled.then(
          ranked => {
            if (state.selected === null) return
            const settled = ranked.some(entry => entry.edge.baseUrl === state.selected?.baseUrl)
              ? ranked
              : [{ edge: state.selected, latencyMs: first.latencyMs }, ...ranked]
            state.ranking = [...settled]
            void this.persistCandidates(state.pluginId, settled)
          },
          () => {},
        )
      } catch (cause) {
        this.markFailed(state, cause instanceof AggregateError ? cause.errors[0] : cause)
        return
      }
      state.backoffStep = 0
    })()
    const wrapped = run.finally(() => {
      if (state.probing === wrapped) state.probing = null
    })
    // 兜底消化：无人 await 时（如超时放弃等待）避免全局未处理拒绝告警。
    wrapped.catch(() => {})
    state.probing = wrapped
    return wrapped
  }

  private select(state: RouterState, winner: RankedEndpoint): void {
    state.status = 'ready'
    state.selected = winner.edge
    state.failCount = 0
    state.ranking = [
      winner,
      ...state.ranking.filter(entry => entry.edge.baseUrl !== winner.edge.baseUrl),
    ]
    this.emitChanged(state.pluginId, winner.edge)
    void this.repo
      .recordProbe(
        state.pluginId,
        { url: winner.edge.baseUrl, label: winner.edge.label, latencyMs: winner.latencyMs },
        toIso(Date.now()),
      )
      .catch(error => {
        this.log.error('选中端点落账失败：%s %o', winner.edge.baseUrl, error)
      })
  }

  /** ready 下运行期失败：计数自增、落账，有次优即切换，否则转 failed 重探退避。 */
  private markFailure(state: RouterState): void {
    const failedUrl = state.selected?.baseUrl
    state.failCount += 1
    if (failedUrl !== undefined) {
      const failedAt = toIso(Date.now())
      void this.repo.recordFailure(state.pluginId, failedUrl, failedAt).catch(error => {
        this.log.error('失败落账异常：%s %o', failedUrl, error)
      })
    }
    const next = state.ranking.find(entry => entry.edge.baseUrl !== failedUrl)
    if (next !== undefined) {
      this.select(state, next)
      return
    }
    state.selected = null
    state.ranking = []
    state.status = 'unprobed'
    this.emitChanged(state.pluginId, null)
    void this.reprobe(state.pluginId).catch(error => {
      this.log.error('无次优时的重探异常：%s %o', state.pluginId, error)
    })
  }

  /** 探测全灭：转 failed 并按退避档位安排自动重探。 */
  private markFailed(state: RouterState, cause: unknown): void {
    state.status = 'failed'
    state.selected = null
    state.lastError = cause
    this.emitChanged(state.pluginId, null)
    const step = Math.min(state.backoffStep, BACKOFF_STEPS_MS.length - 1)
    state.backoffStep += 1
    state.backoffTimer = setTimeout(() => {
      state.backoffTimer = null
      void this.reprobe(state.pluginId).catch(error => {
        this.log.error('退避重探异常：%s %o', state.pluginId, error)
      })
    }, BACKOFF_STEPS_MS[step])
  }

  private async persistCandidates(
    pluginId: string,
    ranked: readonly RankedEndpoint[],
  ): Promise<void> {
    const observedAt = toIso(Date.now())
    try {
      for (const entry of ranked) {
        await this.repo.recordProbe(
          pluginId,
          { url: entry.edge.baseUrl, label: entry.edge.label, latencyMs: entry.latencyMs },
          observedAt,
        )
      }
      await this.repo.removeExcept(
        pluginId,
        ranked.map(entry => entry.edge.baseUrl),
      )
    } catch (error) {
      this.log.error('候选排名落账失败：%s %o', pluginId, error)
    }
  }

  private emitChanged(pluginId: string, edge: Edge | null): void {
    this.ctx.emit('protocol/edge-changed', { pluginId, edge })
  }
}

declare module 'cordis' {
  interface Context {
    edgeRouter: EdgeRouterService
  }
}