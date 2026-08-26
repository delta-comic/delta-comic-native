import { DatabaseSync } from 'node:sqlite'

import { readLedger, type AppliedMigration, type MigrationEntry } from '@delta-comic/db'
import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import { Context } from 'cordis'
import { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'

import type { DiscoveredPlugin, LoaderDatabase, PluginRecord, PluginSource } from '../lib/index'
import { PluginLoaderService } from '../lib/index'

const SHA = 'a'.repeat(64)

interface PluginSpec {
  id: string
  version?: string
  dependencies?: readonly string[]
  migrations?: readonly MigrationEntry[]
  failEntryWith?: string
}

function manifestOf(spec: PluginSpec) {
  return {
    id: spec.id,
    version: spec.version ?? '1.0.0',
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
    capabilities: [] as string[],
    ...(spec.dependencies === undefined ? {} : { dependencies: [...spec.dependencies] }),
  }
}

function discoveredOf(spec: PluginSpec): DiscoveredPlugin {
  const table = spec.id.replaceAll('-', '_')
  return {
    manifest: manifestOf(spec),
    resolveEntry: async () => {
      if (spec.failEntryWith !== undefined) throw new Error(spec.failEntryWith)
      return () => {}
    },
    migrations: spec.migrations ?? [
      {
        pluginId: spec.id,
        n: 1,
        name: 'init',
        up: `CREATE TABLE ${table}(id INTEGER);`,
        down: `DROP TABLE ${table};`,
      },
    ],
  }
}

class TestSource implements PluginSource {
  readonly stage: PluginSource['stage']
  readonly plugins = new Map<string, DiscoveredPlugin>()
  readonly uninstalled: string[] = []

  constructor(stage: PluginSource['stage'], ...specs: readonly DiscoveredPlugin[]) {
    this.stage = stage
    for (const plugin of specs) this.plugins.set(plugin.manifest.id, plugin)
  }

  async discover(): Promise<readonly DiscoveredPlugin[]> {
    return [...this.plugins.values()]
  }

  async uninstall(id: string): Promise<void> {
    this.uninstalled.push(id)
    this.plugins.delete(id)
  }
}

interface Harness {
  service: PluginLoaderService
  db: Kysely<LoaderDatabase>
  events: PluginRecord[]
}

async function harness(source: PluginSource): Promise<Harness> {
  const db = new Kysely<LoaderDatabase>({
    dialect: nodeSqliteDialectFrom(new DatabaseSync(':memory:')),
  })
  const ctx = new Context()
  const events: PluginRecord[] = []
  ctx.on('loader/plugin-state', record => events.push(record))
  const service = new PluginLoaderService(ctx)
  await service.start({ sources: [source], db })
  return { service, db, events }
}

function statesOf(events: readonly PluginRecord[], id: string): string[] {
  return events.filter(event => event.id === id).map(event => event.state)
}

function ledgerIds(rows: readonly AppliedMigration[]): string[] {
  return [...new Set(rows.map(row => row.pluginId))]
}

describe('插件启动管线', () => {
  it('依赖链按拓扑序完成迁移与激活并写入 ledger', async () => {
    const h = await harness(
      new TestSource(
        'user',
        discoveredOf({ id: 'ext', dependencies: ['base'] }),
        discoveredOf({ id: 'base' }),
      ),
    )
    expect(h.service.getRecord('base')).toMatchObject({ state: 'active' })
    expect(h.service.getRecord('base')?.failure).toBeUndefined()
    expect(h.service.getRecord('ext')).toMatchObject({ state: 'active' })
    expect(statesOf(h.events, 'ext')).toEqual([
      'discovered',
      'verified',
      'migrating',
      'migrated',
      'activating',
      'active',
    ])
    expect(
      h.events.findIndex(event => event.id === 'base' && event.state === 'active'),
    ).toBeLessThan(h.events.findIndex(event => event.id === 'ext' && event.state === 'activating'))
    expect(ledgerIds(await readLedger(h.db))).toEqual(['core', 'base', 'ext'])
    expect(
      h.service
        .diagnostics()
        .map(record => record.id)
        .sort(),
    ).toEqual(['base', 'ext'])
  })

  it('manifest 校验失败进入 disabled 且依赖方 unavailable', async () => {
    const h = await harness(
      new TestSource(
        'user',
        discoveredOf({ id: 'dependent', dependencies: ['broken-manifest'] }),
        discoveredOf({ id: 'broken-manifest', version: '1.2' }),
      ),
    )
    expect(h.service.getRecord('broken-manifest')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'verify' },
    })
    expect(h.service.getRecord('dependent')).toMatchObject({
      state: 'unavailable',
      failure: { stage: 'verify', message: '缺少依赖：broken-manifest' },
    })
    expect(ledgerIds(await readLedger(h.db))).toEqual(['core'])
  })

  it('migration 失败进入 disabled 且 ledger 不落账、依赖方 unavailable', async () => {
    const broken = discoveredOf({
      id: 'broken-migrate',
      migrations: [
        { pluginId: 'broken-migrate', n: 1, name: 'init', up: 'CREATE TABLE', down: '' },
      ],
    })
    const h = await harness(
      new TestSource(
        'user',
        discoveredOf({ id: 'client', dependencies: ['broken-migrate'] }),
        broken,
      ),
    )
    expect(h.service.getRecord('broken-migrate')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'migrate' },
    })
    expect(h.service.getRecord('client')).toMatchObject({
      state: 'unavailable',
      failure: { stage: 'verify', message: '依赖不可用：broken-migrate' },
    })
    expect(ledgerIds(await readLedger(h.db))).toEqual(['core'])
  })

  it('激活失败进入 disabled 并持久化，修复后 retry 恢复自身与依赖方', async () => {
    const flaky = { fail: true }
    const spec: PluginSpec & { gate?: { fail: boolean } } = { id: 'flaky', failEntryWith: 'boom' }
    const plugin = discoveredOf(spec)
    const gated: DiscoveredPlugin = {
      ...plugin,
      resolveEntry: async () => {
        if (flaky.fail) throw new Error('boom')
        return () => {}
      },
    }
    const source = new TestSource(
      'user',
      gated,
      discoveredOf({ id: 'fan', dependencies: ['flaky'] }),
    )
    const h = await harness(source)
    expect(h.service.getRecord('flaky')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'activate', message: 'boom' },
    })

    const persisted = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(persisted).toHaveLength(2)
    const flakyRow = persisted.find(row => row.plugin_id === 'flaky')
    expect(flakyRow).toMatchObject({
      state: 'disabled',
      error: JSON.stringify({ stage: 'activate', message: 'boom' }),
    })

    flaky.fail = false
    await h.service.retry('flaky')
    expect(h.service.getRecord('flaky')).toMatchObject({ state: 'active' })
    expect(h.service.getRecord('flaky')?.failure).toBeUndefined()
    expect(h.service.getRecord('fan')).toMatchObject({ state: 'active' })
    const remaining = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(remaining).toHaveLength(0)
    expect(ledgerIds(await readLedger(h.db))).toEqual(['core', 'flaky', 'fan'])
  })

  it('重启时持久化 disabled 跳过管线（即使来源已修复）', async () => {
    const db = new Kysely<LoaderDatabase>({
      dialect: nodeSqliteDialectFrom(new DatabaseSync(':memory:')),
    })
    const broken = discoveredOf({ id: 'sick', failEntryWith: 'first boot fails' })
    const firstSource = new TestSource('user', broken)
    const firstCtx = new Context()
    const first = new PluginLoaderService(firstCtx)
    await first.start({ sources: [firstSource], db })
    expect(first.getRecord('sick')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'activate', message: 'first boot fails' },
    })

    let entries = 0
    const healed: DiscoveredPlugin = {
      ...discoveredOf({ id: 'sick' }),
      resolveEntry: async () => {
        entries += 1
        return () => {}
      },
    }
    const second = new PluginLoaderService(new Context())
    await second.start({ sources: [new TestSource('user', healed)], db })
    expect(second.getRecord('sick')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'activate', message: 'first boot fails' },
    })
    expect(entries).toBe(0)

    await second.retry('sick')
    expect(second.getRecord('sick')).toMatchObject({ state: 'active' })
    expect(entries).toBe(1)
  })

  it('依赖成环时全体 disabled', async () => {
    const h = await harness(
      new TestSource(
        'user',
        discoveredOf({ id: 'loop-a', dependencies: ['loop-b'] }),
        discoveredOf({ id: 'loop-b', dependencies: ['loop-a'] }),
      ),
    )
    expect(h.service.getRecord('loop-a')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'verify' },
    })
    expect(h.service.getRecord('loop-b')).toMatchObject({
      state: 'disabled',
      failure: { stage: 'verify' },
    })
  })

  it('uninstall 停用插件、清理持久化并将依赖方转 unavailable', async () => {
    const source = new TestSource(
      'user',
      discoveredOf({ id: 'provider' }),
      discoveredOf({ id: 'consumer', dependencies: ['provider'] }),
    )
    const h = await harness(source)
    await h.service.uninstall('provider')
    expect(h.service.getRecord('provider')).toBeUndefined()
    expect(source.uninstalled).toEqual(['provider'])
    expect(h.service.getRecord('consumer')).toMatchObject({
      state: 'unavailable',
      failure: { stage: 'verify', message: '缺少依赖：provider' },
    })
    const rows = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(rows.map(row => row.plugin_id)).toEqual(['consumer'])
  })

  it('重复 id 的后者被忽略', async () => {
    const official = new TestSource('official', discoveredOf({ id: 'dup', version: '1.0.0' }))
    const user = new TestSource('user', discoveredOf({ id: 'dup', version: '9.9.9' }))
    const db = new Kysely<LoaderDatabase>({
      dialect: nodeSqliteDialectFrom(new DatabaseSync(':memory:')),
    })
    const ctx = new Context()
    const service = new PluginLoaderService(ctx)
    await service.start({ sources: [official, user], db })
    expect(service.getRecord('dup')).toMatchObject({ version: '1.0.0', state: 'active' })
    expect(service.diagnostics()).toHaveLength(1)
  })
})