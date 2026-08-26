import { DatabaseSync } from 'node:sqlite'

import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import { Context } from 'cordis'
import { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'

import { DatabaseService } from '../lib/database'
import type { DiscoveredPlugin, LoaderDatabase, PluginSource } from '../lib/index'
import { PluginLoaderService } from '../lib/index'

const SHA = 'a'.repeat(64)

function discovered(id: string, options?: { failEntryWith?: string }): DiscoveredPlugin {
  return {
    manifest: {
      id,
      version: '1.0.0',
      hostVersion: '>=1.0.0',
      entries: { common: { path: 'index.js', sha256: SHA } },
      runtime: {
        rn: '^0.87.0',
        hermes: '^2026.1.0',
        bytecode: 96,
        cpu: ['arm64'],
        compileOptions: { dev: 'false' },
      },
      network: { multiEdge: false },
      capabilities: [],
    },
    resolveEntry: async () => {
      if (options?.failEntryWith !== undefined) throw new Error(options.failEntryWith)
      return () => {}
    },
    migrations: [
      {
        pluginId: id,
        n: 1,
        name: 'init',
        up: `CREATE TABLE ${id.replaceAll('-', '_')}(id INTEGER);`,
        down: `DROP TABLE ${id.replaceAll('-', '_')};`,
      },
    ],
  }
}

class TestSource implements PluginSource {
  readonly stage = 'user' as const
  constructor(private readonly plugins: readonly DiscoveredPlugin[]) {}

  async discover(): Promise<readonly DiscoveredPlugin[]> {
    return this.plugins
  }
}

async function harness(...plugins: readonly DiscoveredPlugin[]) {
  const db = new Kysely<LoaderDatabase>({
    dialect: nodeSqliteDialectFrom(new DatabaseSync(':memory:')),
  })
  const ctx = new Context()
  const service = new PluginLoaderService(ctx)
  await service.start({ sources: [new TestSource(plugins)], db })
  return { ctx, service, db }
}

describe('调试通道 loader 扩展', () => {
  it('manifestOf 返回 manifest 原文', async () => {
    const plugin = discovered('sample')
    const h = await harness(plugin)
    expect(h.service.manifestOf('sample')).toEqual(plugin.manifest)
    expect(h.service.manifestOf('missing')).toBeUndefined()
  })

  it('reload 停旧 fiber 后重新激活', async () => {
    let activations = 0
    const base = discovered('reloadable')
    const gated: DiscoveredPlugin = {
      ...base,
      resolveEntry: async () => {
        activations += 1
        return () => {}
      },
    }
    const h = await harness(gated)
    expect(h.service.getRecord('reloadable')).toMatchObject({ state: 'active' })
    expect(activations).toBe(1)

    await h.service.reload('reloadable')
    expect(activations).toBe(2)
    expect(h.service.getRecord('reloadable')).toMatchObject({ state: 'active' })
    expect(h.service.getRecord('reloadable')?.failure).toBeUndefined()
  })

  it('reload 激活失败进入 disabled 并落盘，retry 可恢复', async () => {
    let healthy = true
    const base = discovered('flaky')
    const gated: DiscoveredPlugin = {
      ...base,
      resolveEntry: async () => {
        if (!healthy) throw new Error('second boot fails')
        return () => {}
      },
    }
    const h = await harness(gated)
    healthy = false
    await h.service.reload('flaky')
    expect(h.service.getRecord('flaky')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'activate', message: 'second boot fails' },
    })
    const rows = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(rows.find(row => row.plugin_id === 'flaky')).toMatchObject({ state: 'disabled' })

    healthy = true
    await h.service.retry('flaky')
    expect(h.service.getRecord('flaky')).toMatchObject({ state: 'active' })
  })

  it('disable 卸载 fiber 且持久化 disabled（failure 为空），重启语义由 restore 保证', async () => {
    const h = await harness(discovered('target'), discovered('fan'))
    await h.service.disable('target')
    expect(h.service.getRecord('target')).toMatchObject({ state: 'disabled' })
    expect(h.service.getRecord('target')?.failure).toBeUndefined()
    const rows = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(rows.find(row => row.plugin_id === 'target')).toMatchObject({
      state: 'disabled',
      error: null,
    })
  })

  it('disable 对 unavailable 插件生效、对非运行态拒绝', async () => {
    const broken = discovered('sick-manifest')
    ;(broken.manifest as { version: string }).version = 'bad'
    const h = await harness(broken, discovered('healthy'))
    expect(h.service.getRecord('sick-manifest')).toMatchObject({ state: 'disabled' })

    await expect(h.service.reload('missing-id')).rejects.toThrow('插件不存在')
    await expect(h.service.disable('missing-id')).rejects.toThrow('插件不存在')
    await expect(
      h.service.reload('healthy').then(() => h.service.disable('healthy')),
    ).resolves.toBe(undefined)
  })
})

describe('DatabaseService', () => {
  it('注册后可经 ctx.database 访问同一 Kysely 实例', async () => {
    const db = new Kysely<LoaderDatabase>({
      dialect: nodeSqliteDialectFrom(new DatabaseSync(':memory:')),
    })
    const ctx = new Context()
    const service = new DatabaseService(ctx, db)
    expect(ctx.database.db).toBe(db)
    await ctx.fiber.dispose()
    void service
  })
})