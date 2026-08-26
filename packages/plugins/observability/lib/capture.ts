import { RingBuffer } from './ring'

/** 归一化日志条目；args 已序列化为字符串数组。 */
export interface LogRecord {
  readonly sn: number
  readonly ts: string
  readonly name: string
  readonly level: 'error' | 'warn' | 'info' | 'debug'
  readonly message: string
}

export interface LogCapture {
  tail(limit: number): LogRecord[]
  format(limit: number): string
}

function serializeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg) ?? String(arg)
  } catch {
    return String(arg)
  }
}

/** printf 轻量格式化：按序消费 %s/%d/%i/%f/%o/%j 占位符，剩余实参空格拼接。 */
function formatMessage(args: unknown[]): string {
  const pattern = /%[sdifoj]/g
  let index = 1
  const head = serializeArg(args[0]).replace(pattern, () => serializeArg(args[index++]))
  const rest = args.slice(index).map(serializeArg)
  return rest.length > 0 ? `${head} ${rest.join(' ')}` : head
}

/** 挂载日志捕获：经 ctx.logger.exporter 收集本 fiber 树全部日志进环形缓冲。 */
export function attachLogCapture(ctx: import('cordis').Context, capacity = 500): LogCapture {
  const ring = new RingBuffer<LogRecord>(capacity)
  let seq = 0
  ctx.effect(() => {
    const levels = new Set(['error', 'warn', 'info', 'debug'])
    return ctx.logger.exporter({
      export(message: {
        sn: number
        ts?: number
        name?: string
        type?: string
        args: unknown[]
      }): void {
        const type = typeof message.type === 'string' ? message.type : 'info'
        ring.push({
          sn: message.sn,
          ts: new Date(message.ts ?? Date.now()).toISOString(),
          name: message.name ?? 'app',
          level: levels.has(type) ? (type as LogRecord['level']) : 'info',
          message: formatMessage([...message.args]),
        })
        seq++
      },
    })
  }, 'observability/log-capture')
  return {
    tail(limit: number): LogRecord[] {
      void seq
      return ring.snapshot().slice(-limit)
    },
    format(limit: number): string {
      return ring
        .snapshot()
        .slice(-limit)
        .map(record => `${record.ts} [${record.level}] ${record.name}: ${record.message}`)
        .join('\n')
    },
  }
}