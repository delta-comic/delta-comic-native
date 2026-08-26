import { Service } from 'cordis'
import type { Context } from 'cordis'

import { attachLogCapture } from './capture'
import { attachCrashCapture } from './crash'
import type { CrashHooks } from './crash'
import { exportDiagnostics } from './diagnostics'
import type { DiagnosticsDb, DiagnosticsProviders, DiagnosticBundle } from './diagnostics'
import { createMemorySink } from './sink'
import type { LogSink } from './sink'

export interface ObservabilityConfig {
  /** 内存日志缓冲容量；默认 500。 */
  readonly capacity?: number
  /** 日志落盘通道；缺省使用进程内内存环形（Web 形态）。 */
  readonly sink?: LogSink
  /** 全局崩溃钩子；提供后启用崩溃捕获。 */
  readonly crashHooks?: CrashHooks
  /** 提供宿主数据库时诊断包含 migration ledger。 */
  readonly db?: DiagnosticsDb
  readonly providers?: DiagnosticsProviders
  readonly platform?: string
}

/** 可观测性句柄：日志尾读、崩溃状态与诊断导出。 */
export class ObservabilityService extends Service {
  private readonly exporter: () => Promise<DiagnosticBundle>
  private crashPendingFn: () => boolean = () => false
  private lastCrashFn: () => string | null = () => null

  constructor(ctx: Context, config: ObservabilityConfig = {}) {
    super(ctx, 'observability')
    const capture = attachLogCapture(ctx, config.capacity)
    const sink = config.sink ?? createMemorySink()
    if (config.crashHooks !== undefined) {
      const crash = attachCrashCapture(line => sink.append(line), config.crashHooks)
      this.crashPendingFn = () => crash.crashPending()
      this.lastCrashFn = () => crash.lastCrash()
    }
    this.exporter = () =>
      exportDiagnostics(capture, {
        platform: config.platform,
        db: config.db,
        providers: config.providers,
      })
  }

  crashPending(): boolean {
    return this.crashPendingFn()
  }

  lastCrash(): string | null {
    return this.lastCrashFn()
  }

  async diagnostics(): Promise<DiagnosticBundle> {
    return await this.exporter()
  }
}

declare module 'cordis' {
  interface Context {
    observability: ObservabilityService
  }
}

export { attachCrashCapture, nodeCrashHooks } from './crash'
export { attachLogCapture } from './capture'
export { exportDiagnostics } from './diagnostics'
export { createMemorySink, createRollingSink } from './sink'
export type { FileAdapter, LogSink, RollingSinkOptions } from './sink'
export type { CrashCapture, CrashHandler, CrashHooks } from './crash'
export type { LogRecord } from './capture'
export type { DiagnosticsDb, DiagnosticsProviders, DiagnosticBundle } from './diagnostics'