import TimerService from '@cordisjs/plugin-timer'
import { Service } from 'cordis'
import type { Context, Disposable } from 'cordis'

/** 调度器配置；concurrency 为进程内任务并发上限。 */
export interface SchedulerConfig {
  concurrency?: number
}

/** 入队选项；priority 越大越先执行，同优先级按入队顺序 FIFO。 */
export interface EnqueueOptions {
  priority?: number
}

/** 队列诊断条目；id 为单调递增任务序号。 */
export interface QueuedJobSnapshot {
  id: number
  priority: number
}

/** 周期任务诊断条目。 */
export interface PeriodicSnapshot {
  id: string
  intervalMs: number
}

/** 调度器状态快照，供可观测性诊断导出。 */
export interface SchedulerSnapshot {
  concurrency: number
  running: number
  queued: QueuedJobSnapshot[]
  periods: PeriodicSnapshot[]
}

interface QueuedJob {
  seq: number
  priority: number
  run(): Promise<void>
  cancelled: boolean
}

interface PeriodicTask {
  id: string
  intervalMs: number
  cancel(): void
}

const DEFAULT_CONCURRENCY = 4

/**
 * 进程内调度服务：优先级队列 + 并发上限 + 周期任务注册。
 * 底层依赖 @cordisjs/plugin-timer，所有计时随 fiber 卸载自动清理。
 */
export class SchedulerService extends Service {
  static inject = ['timer']

  /** 任务并发上限。 */
  readonly concurrency: number

  private readonly queue: QueuedJob[] = []
  private running = 0
  private nextSeq = 1
  private readonly periods = new Map<string, PeriodicTask>()

  constructor(ctx: Context, config: SchedulerConfig = {}) {
    const concurrency = config.concurrency ?? DEFAULT_CONCURRENCY
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error(`invalid scheduler concurrency ${concurrency}`)
    }
    super(ctx, 'scheduler')
    this.concurrency = concurrency
  }

  async *[Service.init](): AsyncGenerator<Disposable> {
    yield () => {
      for (const task of this.periods.values()) task.cancel()
      this.periods.clear()
      for (const job of this.queue) job.cancelled = true
      this.queue.length = 0
    }
  }

  /**
   * 入队一个异步任务，立即或在并发空位出现时执行。
   * 返回的 disposer 可撤销尚未开始的任务；已开始的任务不可中断。
   */
  enqueue(run: () => Promise<void>, options: EnqueueOptions = {}): Disposable {
    const job: QueuedJob = {
      seq: this.nextSeq++,
      priority: options.priority ?? 0,
      run,
      cancelled: false,
    }
    this.queue.push(job)
    this.pump()
    let active = true
    return () => {
      if (!active) return
      active = false
      job.cancelled = true
      const index = this.queue.indexOf(job)
      if (index >= 0) this.queue.splice(index, 1)
    }
  }

  /**
   * 注册周期任务：每 intervalMs 执行一次 run（首个 tick 在 intervalMs 后）。
   * 同 id 重复注册替换旧任务以支持插件热重载；run 抛错只记录日志不中断循环。
   */
  every(id: string, intervalMs: number, run: (tick: number) => Promise<void> | void): Disposable {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(`invalid periodic interval ${intervalMs} for ${id}`)
    }
    this.periods.get(id)?.cancel()
    let tick = 0
    const cancel = this.ctx.interval(() => {
      tick++
      void Promise.resolve()
        .then(() => run(tick))
        .catch((cause: unknown) => {
          this.ctx.logger.warn('periodic task %s tick %d failed: %o', id, tick, cause)
        })
    }, intervalMs)
    const task: PeriodicTask = { id, intervalMs, cancel }
    this.periods.set(id, task)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.periods.get(id) === task) {
        this.periods.delete(id)
        task.cancel()
      }
    }
  }

  /** 当前状态快照。 */
  snapshot(): SchedulerSnapshot {
    return {
      concurrency: this.concurrency,
      running: this.running,
      queued: this.queue.map(job => ({ id: job.seq, priority: job.priority })),
      periods: [...this.periods.values()].map(task => ({
        id: task.id,
        intervalMs: task.intervalMs,
      })),
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      let best = -1
      for (let i = 0; i < this.queue.length; i++) {
        const candidate = this.queue[i]
        if (!candidate || candidate.cancelled) continue
        const current = best >= 0 ? this.queue[best] : undefined
        if (!current || candidate.priority > current.priority) best = i
      }
      if (best < 0) return
      const [job] = this.queue.splice(best, 1)
      if (!job) return
      this.running++
      void job
        .run()
        .catch((cause: unknown) => {
          this.ctx.logger.warn('scheduler job #%d failed: %o', job.seq, cause)
        })
        .finally(() => {
          this.running--
          this.pump()
        })
    }
  }
}

declare module 'cordis' {
  interface Context {
    scheduler: SchedulerService
  }
}

/** 挂载调度器：宿主尚未提供 timer 服务时自动补挂 @cordisjs/plugin-timer。 */
export async function apply(ctx: Context, config: SchedulerConfig = {}): Promise<void> {
  if (!ctx.get('timer')) {
    await ctx.plugin(TimerService)
  }
  await ctx.plugin(SchedulerService, config)
}