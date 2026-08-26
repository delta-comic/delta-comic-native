import { DatabaseSync } from 'node:sqlite'

import {
  applyMigrations,
  coreMigrations,
  type CoreDatabase,
  type MigrationLedgerDatabase,
} from '@delta-comic/db'
import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import { Context } from 'cordis'
import { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'

import { ObservabilityService } from '../lib/index'
import type { CrashHandler, CrashHooks, FileAdapter } from '../lib/index'
import { RingBuffer } from '../lib/ring'
import { createMemorySink, createRollingSink } from '../lib/sink'

function fakeHooks(): CrashHooks & { errors: CrashHandler[]; rejections: CrashHandler[] } {
  const errors: CrashHandler[] = []
  const rejections: CrashHandler[] = []
  return {
    errors,
    rejections,
    registerErrorHandler(handler) {
      errors.push(handler)
    },
    registerRejectionHandler(handler) {
      rejections.push(handler)
    },
  }
}

async function createDb(): Promise<Kysely<MigrationLedgerDatabase & CoreDatabase>> {
  const sqlite = new DatabaseSync(':memory:')
  const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
  await applyMigrations(ledger, [...coreMigrations])
  return new Kysely<MigrationLedgerDatabase & CoreDatabase>({
    dialect: nodeSqliteDialectFrom(sqlite),
  })
}

describe('ring buffer', () => {
  it('超限淘汰最旧，snapshot 保持写入顺序', () => {
    const ring = new RingBuffer<number>(3)
    for (const value of [1, 2, 3, 4]) ring.push(value)
    expect(ring.snapshot()).toEqual([2, 3, 4])
    expect(ring.size).toBe(3)
  })

  it('非法容量抛错', () => {
    expect(() => new RingBuffer(0)).toThrow('invalid ring capacity 0')
  })
})

describe('log capture', () => {
  it('服务装配后 tail/format 可读', async () => {
    const ctx = new Context()
    await ctx.plugin(ObservabilityService, { platform: 'test' })
    ctx.logger.info('%s 启动', 'app')
    ctx.logger.error('boom')
    const svc = ctx.observability
    const bundle = await svc.diagnostics()
    expect(bundle.platform).toBe('test')
    expect(bundle.logs.some(line => line.includes('app 启动'))).toBe(true)
    expect(bundle.logs.some(line => line.includes('[error]') && line.includes('boom'))).toBe(true)
  })
})

describe('sinks', () => {
  it('memory sink 容量截断', async () => {
    const sink = createMemorySink(2)
    await sink.append('a')
    await sink.append('b')
    await sink.append('c')
    expect(sink.lines()).toEqual(['b', 'c'])
  })

  it('rolling sink 超限轮转并按上限清理归档', async () => {
    const calls: string[] = []
    const removed: string[] = []
    const adapter: FileAdapter & { remove(path: string): Promise<void> } = {
      appendFile: async (path, text) => {
        calls.push(`append:${path}:${text.trim()}`)
      },
      rotate: async (_path, archivePath) => {
        calls.push(`rotate:${archivePath}`)
      },
      remove: async path => {
        removed.push(path)
      },
    }
    const sink = createRollingSink(adapter, { path: 'logs/app.log', maxBytes: 10, maxArchives: 1 })
    await sink.append('12345')
    await sink.append('67890')
    await sink.append('abcde')
    expect(calls[0]).toContain('append:logs/app.log:12345')
    expect(calls).toContain('rotate:logs/app.log.0')
    expect(calls.filter(call => call.startsWith('append'))).toHaveLength(3)
    expect(removed).toEqual([])
  })
})

describe('crash capture', () => {
  it('崩溃写入通道并置 pending；rejection 同样覆盖', async () => {
    const hooks = fakeHooks()
    const sink = createMemorySink(10)
    const ctx = new Context()
    await ctx.plugin(ObservabilityService, { crashHooks: hooks, sink })
    const svc = ctx.observability
    expect(svc.crashPending()).toBe(false)
    const cause = new Error('render exploded')
    hooks.errors[0]?.(cause)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(svc.crashPending()).toBe(true)
    expect(svc.lastCrash()).toContain('[crash] error Error: render exploded')
    expect(sink.lines().join('\n')).toContain('render exploded')
    hooks.rejections[0]?.('rejected-value')
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    expect(sink.lines().join('\n')).toContain('rejected-value')
  })

  it('未提供 crashHooks 时 pending 恒为 false', async () => {
    const ctx = new Context()
    await ctx.plugin(ObservabilityService)
    expect(ctx.observability.crashPending()).toBe(false)
  })
})

describe('diagnostics bundle', () => {
  it('providers 与 db 注入后聚合完整包', async () => {
    const ctx = new Context()
    const db = await createDb()
    await ctx.plugin(ObservabilityService, {
      platform: 'desktop',
      db,
      providers: {
        plugins: () => [{ id: 'sample', state: 'active' }],
        audit: async limit =>
          Array.from({ length: 2 }, (_, index) => ({ kind: 'deny', index, limit })),
      },
    })
    ctx.logger.warn('warn-line')
    const bundle = await ctx.observability.diagnostics()
    expect(bundle.platform).toBe('desktop')
    expect(bundle.plugins).toEqual([{ id: 'sample', state: 'active' }])
    expect(bundle.audit).toHaveLength(2)
    expect(bundle.ledger.length).toBeGreaterThan(0)
    expect(bundle.ledger[0]).toMatchObject({ pluginId: 'core', n: 1 })
    expect(new Date(bundle.exportedAt).getTime()).toBeGreaterThan(0)
  })
})