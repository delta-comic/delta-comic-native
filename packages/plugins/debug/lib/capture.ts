/**
 * 调试通道环形捕获：日志与事件。
 *
 * - 日志经 LoggerService.exporter 注册（Disposable 随 fiber 自动清理）
 * - 事件挂 internal/dispatch 全事件观察点，internal:* 自身不入环避免自激
 */
import type { Context } from 'cordis'

import { safeSerialize } from './serialize'

export interface DebugLogEntry {
  readonly sn: number
  readonly ts: number
  readonly scope: string
  readonly level: 'error' | 'warn' | 'info' | 'debug'
  readonly args: unknown[]
}

export interface DebugEventEntry {
  readonly sn: number
  readonly ts: number
  readonly mode: string
  readonly name: string
  readonly args: unknown[]
}

export class RingBuffer<T> {
  private readonly items: T[] = []

  constructor(readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity)
  }

  snapshot(): readonly T[] {
    return [...this.items]
  }
}

export type DebugLogLevel = DebugLogEntry['level']

const LOG_LEVELS: readonly DebugLogLevel[] = ['error', 'warn', 'info', 'debug']

export interface CaptureFilters {
  readonly level?: DebugLogLevel
  readonly scope?: string
}

export function matchLogEntry(entry: DebugLogEntry, filters: CaptureFilters): boolean {
  if (filters.level !== undefined && entry.level !== filters.level) return false
  if (filters.scope !== undefined && !entry.scope.startsWith(filters.scope)) return false
  return true
}

/** 挂载捕获并返回只读快照访问器；注册随调用方 fiber 卸载自动清理。 */
export function attachDebugCapture(ctx: Context, capacity = 500) {
  const logs = new RingBuffer<DebugLogEntry>(capacity)
  const events = new RingBuffer<DebugEventEntry>(capacity)
  let eventSn = 0

  ctx.logger.exporter({
    export(message) {
      const level = LOG_LEVELS.find(candidate => candidate === message.type)
      if (level === undefined) return
      logs.push({
        sn: message.sn,
        ts: message.ts,
        scope: message.name,
        level,
        args: message.args.map(arg => safeSerialize(arg)),
      })
    },
  })

  ctx.on('internal/dispatch', (mode, name, args) => {
    if (name.startsWith('internal/')) return
    eventSn += 1
    events.push({
      sn: eventSn,
      ts: Date.now(),
      mode,
      name,
      args: args.map(arg => safeSerialize(arg)),
    })
  })

  return {
    tailLogs(limit: number, filters: CaptureFilters = {}): readonly DebugLogEntry[] {
      const matched = logs.snapshot().filter(entry => matchLogEntry(entry, filters))
      return matched.slice(-limit).reverse()
    },
    searchLogs(
      query: string,
      limit: number,
      filters: CaptureFilters = {},
    ): readonly DebugLogEntry[] {
      const needle = query.toLowerCase()
      return logs
        .snapshot()
        .filter(entry => matchLogEntry(entry, filters))
        .filter(entry => JSON.stringify(entry.args).toLowerCase().includes(needle))
        .slice(-limit)
        .reverse()
    },
    recentEvents(limit: number, namePrefix?: string): readonly DebugEventEntry[] {
      const matched =
        namePrefix === undefined
          ? events.snapshot()
          : events.snapshot().filter(entry => entry.name.startsWith(namePrefix))
      return matched.slice(-limit).reverse()
    },
  }
}