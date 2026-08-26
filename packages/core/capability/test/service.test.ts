import { DatabaseSync } from 'node:sqlite'

import { applyMigrations, coreMigrations, type CoreDatabase } from '@delta-comic/db'
import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import { Context } from 'cordis'
import { Kysely } from 'kysely'
import { describe, expect, it, vi } from 'vitest'

import { CapabilityDeniedError, CapabilityService } from '../lib/service'

export async function createCapabilityDb(): Promise<Kysely<CoreDatabase>> {
  const sqlite = new DatabaseSync(':memory:')
  const db = new Kysely<CoreDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })
  const ledger = new Kysely({ dialect: nodeSqliteDialectFrom(sqlite) })
  await applyMigrations(ledger, [...coreMigrations])
  await ledger.destroy()
  return db
}

export async function createService(
  db?: Kysely<CoreDatabase>,
): Promise<{ ctx: Context; service: InstanceType<typeof CapabilityService> }> {
  const ctx = new Context()
  await ctx.plugin(CapabilityService, db ? { db } : {})
  return { ctx, service: ctx.capability }
}

describe('capability grants', () => {
  it('grant 声明能力集，disposer 移除', async () => {
    const { service } = await createService()
    expect(service.capabilitiesOf('sample')).toEqual([])
    const dispose = service.grant('sample', ['notify', 'clipboard'])
    expect(service.capabilitiesOf('sample')).toEqual(['clipboard', 'notify'])
    dispose()
    expect(service.capabilitiesOf('sample')).toEqual([])
  })

  it('重复 grant 替换旧集合', async () => {
    const { service } = await createService()
    service.grant('sample', ['notify'])
    service.grant('sample', ['share'])
    expect(service.capabilitiesOf('sample')).toEqual(['share'])
  })

  it('snapshot 汇总全部插件声明', async () => {
    const { service } = await createService()
    service.grant('b-plugin', ['share'])
    service.grant('a-plugin', [])
    expect(service.snapshot()).toEqual([
      { pluginId: 'a-plugin', capabilities: [] },
      { pluginId: 'b-plugin', capabilities: ['share'] },
    ])
  })
})

describe('capability gate', () => {
  it('assert 未声明抛结构化错误并记 deny 审计', async () => {
    const { ctx, service } = await createService()
    const listener = vi.fn<(entry: unknown) => void>()
    ctx.on('capability/audited', listener)
    let denied: unknown
    try {
      service.assert('sample', 'notify')
    } catch (cause) {
      denied = cause
    }
    expect(denied).toBeInstanceOf(CapabilityDeniedError)
    expect((denied as CapabilityDeniedError).code).toBe('capability-denied')
    expect(listener).toHaveBeenCalledOnce()
    const audits = await service.recentAudit(10)
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ kind: 'deny', pluginId: 'sample', capability: 'notify' })
  })

  it('guard 放行记录 invoke，返回结果', async () => {
    const { service } = await createService()
    service.grant('sample', ['clipboard'])
    const result = await service.guard('sample', 'clipboard', 'read', async () => 'ok')
    expect(result).toBe('ok')
    const audits = await service.recentAudit(10)
    expect(audits.map(a => a.kind)).toEqual(['invoke'])
    expect(JSON.parse(audits[0]?.detail ?? '{}')).toEqual({ action: 'read' })
  })

  it('guard 执行出错记录 error 审计后原样重抛', async () => {
    const { service } = await createService()
    service.grant('sample', ['share'])
    await expect(
      service.guard('sample', 'share', 'text', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const audits = await service.recentAudit(10)
    expect(audits.map(a => a.kind)).toEqual(['error', 'invoke'])
    expect(JSON.parse(audits[0]?.detail ?? '{}')).toEqual({ action: 'text', message: 'boom' })
  })

  it('guard 未声明直接拒绝不执行 run', async () => {
    const { service } = await createService()
    let ran = false
    await expect(
      service.guard('sample', 'notify', 'push', async () => {
        ran = true
      }),
    ).rejects.toMatchObject({ code: 'capability-denied' })
    expect(ran).toBe(false)
  })
})

describe('capability persistence', () => {
  it('db 模式下审计持久化并可裁剪', async () => {
    const db = await createCapabilityDb()
    const { service } = await createService(db)
    service.grant('sample', ['notify'])
    await service.guard('sample', 'notify', 'push', async () => undefined)
    try {
      service.assert('other', 'share')
    } catch {}
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    const audits = await service.recentAudit(10)
    expect(audits).toHaveLength(2)
    expect(audits.map(a => a.kind)).toEqual(['deny', 'invoke'])

    const cutoff = new Date(Date.now() + 60_000)
    expect(await service.pruneAuditBefore(cutoff)).toBe(2)
    expect(await service.recentAudit(10)).toEqual([])
    await db.destroy()
  })

  it('内存模式 recentAudit 返回最近条目（新→旧）', async () => {
    const { service } = await createService()
    try {
      service.assert('a-plugin', 'x')
    } catch {}
    try {
      service.assert('b-plugin', 'y')
    } catch {}
    const audits = await service.recentAudit(10)
    expect(audits.map(a => a.pluginId)).toEqual(['b-plugin', 'a-plugin'])
  })
})