import TimerService from '@cordisjs/plugin-timer'
import { Context } from 'cordis'

import { SchedulerService } from '../lib/service'
import type { SchedulerConfig } from '../lib/service'

export interface SchedulerHarness {
  ctx: Context
  service: InstanceType<typeof SchedulerService>
  fiber: { dispose(): Promise<void> }
}

export async function createScheduler(config?: SchedulerConfig): Promise<SchedulerHarness> {
  const ctx = new Context()
  await ctx.plugin(TimerService)
  const fiber = ctx.plugin(SchedulerService, config)
  await fiber
  return { ctx, service: ctx.scheduler, fiber }
}

export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
}

export async function microFlush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

export function deferred(): {
  promise: Promise<void>
  resolve(): void
  reject(cause: unknown): void
} {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}