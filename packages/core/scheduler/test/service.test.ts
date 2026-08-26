import { Context } from 'cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SchedulerService } from '../lib/service'

import { createScheduler, deferred, flush, microFlush } from './util'
import type { SchedulerHarness } from './util'

afterEach(() => {
  vi.useRealTimers()
})

describe('scheduler queue', () => {
  it('按并发上限执行并遵循优先级', async () => {
    const { service } = await createScheduler({ concurrency: 2 })
    const started: string[] = []
    const gates = { a: deferred(), b: deferred(), c: deferred(), d: deferred() }
    service.enqueue(async () => {
      started.push('a')
      await gates.a.promise
    })
    service.enqueue(async () => {
      started.push('b')
      await gates.b.promise
    })
    service.enqueue(
      async () => {
        started.push('c')
        await gates.c.promise
      },
      { priority: 5 },
    )
    service.enqueue(
      async () => {
        started.push('d')
        await gates.d.promise
      },
      { priority: 9 },
    )

    expect(started).toEqual(['a', 'b'])
    gates.a.resolve()
    await flush()
    expect(started).toEqual(['a', 'b', 'd'])
    gates.b.resolve()
    await flush()
    expect(started).toEqual(['a', 'b', 'd', 'c'])
    gates.c.resolve()
    gates.d.resolve()
  })

  it('disposer 撤销尚未开始的任务', async () => {
    const { service } = await createScheduler({ concurrency: 1 })
    const gate = deferred()
    const started: string[] = []
    service.enqueue(async () => {
      started.push('running')
      await gate.promise
    })
    const cancel = service.enqueue(async () => {
      started.push('queued')
    })
    cancel()
    expect(service.snapshot().queued).toHaveLength(0)
    gate.resolve()
    await flush()
    expect(started).toEqual(['running'])
  })

  it('任务异常只记录不阻塞后续任务', async () => {
    const warn = vi.fn<(...args: unknown[]) => void>()
    const harness = await createScheduler({ concurrency: 1 })
    harness.ctx.logger.warn = warn as typeof harness.ctx.logger.warn
    const started: string[] = []
    harness.service.enqueue(async () => {
      started.push('first')
      throw new Error('boom')
    })
    harness.service.enqueue(async () => {
      started.push('second')
    })
    await flush()
    expect(started).toEqual(['first', 'second'])
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('scheduler periodic', () => {
  it('周期触发且单次异常不中断循环', async () => {
    vi.useFakeTimers()
    const { service } = await createScheduler()
    const ticks: number[] = []
    service.every('task', 100, tick => {
      ticks.push(tick)
      if (tick === 1) throw new Error('tick failed')
    })
    await vi.advanceTimersByTimeAsync(350)
    expect(ticks).toEqual([1, 2, 3])
  })

  it('同 id 重复注册替换旧任务', async () => {
    vi.useFakeTimers()
    const { service } = await createScheduler()
    const first: number[] = []
    const second: number[] = []
    service.every('dup', 50, tick => {
      first.push(tick)
    })
    service.every('dup', 50, tick => {
      second.push(tick)
    })
    await vi.advanceTimersByTimeAsync(120)
    expect(first).toEqual([])
    expect(second.length).toBeGreaterThan(0)
    expect(service.snapshot().periods).toEqual([{ id: 'dup', intervalMs: 50 }])
  })

  it('disposer 停止对应周期任务', async () => {
    vi.useFakeTimers()
    const { service } = await createScheduler()
    const ticks: number[] = []
    const cancelA = service.every('a', 50, () => {
      ticks.push('a' as unknown as number)
    })
    service.every('b', 50, () => {})
    cancelA()
    cancelA()
    await vi.advanceTimersByTimeAsync(110)
    expect(ticks).toEqual([])
    expect(service.snapshot().periods.map(p => p.id)).toEqual(['b'])
  })
})

describe('scheduler lifecycle', () => {
  it('非法配置立即抛错', () => {
    const ctx = new Context()
    expect(() => new SchedulerService(ctx, { concurrency: 0 })).toThrow(
      'invalid scheduler concurrency 0',
    )
    expect(() => new SchedulerService(ctx, { concurrency: 1.5 })).toThrow(
      'invalid scheduler concurrency 1.5',
    )
  })

  it('every 非法间隔抛错', async () => {
    const { service } = await createScheduler()
    expect(() => service.every('bad', 0, () => {})).toThrow('invalid periodic interval 0 for bad')
    expect(() => service.every('bad', Number.NaN, () => {})).toThrow('bad')
  })

  it('服务卸载清理周期任务与待执行队列', async () => {
    vi.useFakeTimers()
    const harness: SchedulerHarness = await createScheduler({ concurrency: 1 })
    const { service, fiber } = harness
    const ticks: number[] = []
    service.every('loop', 50, () => {
      ticks.push(1)
    })
    const gate = deferred()
    let ranQueued = false
    service.enqueue(async () => {
      await gate.promise
    })
    service.enqueue(async () => {
      ranQueued = true
    })
    await fiber.dispose()
    gate.resolve()
    await microFlush()
    await vi.advanceTimersByTimeAsync(200)
    expect(ticks).toEqual([])
    expect(ranQueued).toBe(false)
  })

  it('snapshot 反映运行状态', async () => {
    const { service } = await createScheduler({ concurrency: 1 })
    const gate = deferred()
    service.enqueue(
      async () => {
        await gate.promise
      },
      { priority: 3 },
    )
    service.enqueue(async () => {}, { priority: 7 })
    const snap = service.snapshot()
    expect(snap.concurrency).toBe(1)
    expect(snap.running).toBe(1)
    expect(snap.queued).toEqual([{ id: 2, priority: 7 }])
    expect(snap.periods).toEqual([])
    gate.resolve()
    await flush()
  })
})