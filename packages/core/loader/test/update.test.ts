import { DatabaseSync } from 'node:sqlite'

import { readLedger, type MigrationEntry } from '@delta-comic/db'
import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import { Context } from 'cordis'
import { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'

import type {
  DiscoveredPlugin,
  LoaderDatabase,
  LoaderRolledBackEvent,
  PluginSource,
} from '../lib/index'
import { PluginLoaderService } from '../lib/index'

const SHA = 'a'.repeat(64)

interface PluginSpec {
  id: string
  version?: string
  dependencies?: readonly string[]
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

function discoveredOf(
  spec: PluginSpec,
  options: {
    migrations?: readonly MigrationEntry[]
    onResolveEntry?: () => void
    failEntryWith?: string
  } = {},
): DiscoveredPlugin {
  return {
    manifest: manifestOf(spec),
    resolveEntry: async () => {
      options.onResolveEntry?.()
      if (options.failEntryWith !== undefined) throw new Error(options.failEntryWith)
      return () => {}
    },
    migrations: options.migrations ?? [],
  }
}

class Source implements PluginSource {
  readonly stage = 'user' as const

  constructor(private readonly plugins: readonly DiscoveredPlugin[]) {}

  async discover(): Promise<readonly DiscoveredPlugin[]> {
    return this.plugins
  }
}

async function startWith(plugin: DiscoveredPlugin) {
  const sqlite = new DatabaseSync(':memory:')
  const db = new Kysely<LoaderDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })
  const ctx = new Context()
  const rolled: LoaderRolledBackEvent[] = []
  ctx.on('loader/rolled-back', event => rolled.push(event))
  const service = new PluginLoaderService(ctx)
  await service.start({ sources: [new Source([plugin])], db })
  return { service, db, sqlite, rolled }
}

describe('插件更新回滚', () => {
  it('成功更新：增量迁移落账并换装新 fiber', async () => {
    let v1Entries = 0
    let v2Entries = 0
    const v1 = discoveredOf(
      { id: 'base' },
      {
        onResolveEntry: () => {
          v1Entries += 1
        },
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
        ],
      },
    )
    const h = await startWith(v1)
    const v2 = discoveredOf(
      { id: 'base', version: '2.0.0' },
      {
        onResolveEntry: () => {
          v2Entries += 1
        },
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
          {
            pluginId: 'base',
            n: 2,
            name: 'add-label',
            up: 'ALTER TABLE base ADD COLUMN label TEXT;',
            down: 'ALTER TABLE base DROP COLUMN label;',
          },
        ],
      },
    )

    await h.service.update('base', v2)

    expect(h.service.getRecord('base')).toMatchObject({ version: '2.0.0', state: 'active' })
    expect(h.service.getRecord('base')?.failure).toBeUndefined()
    expect(v1Entries).toBe(1)
    expect(v2Entries).toBe(1)
    expect((await readLedger(h.db)).map(row => `${row.pluginId}/${row.n}`)).toEqual([
      'core/1',
      'core/2',
      'core/3',
      'base/1',
      'base/2',
    ])
    h.sqlite.prepare('SELECT label FROM base').all()
    expect(await h.db.selectFrom('plugin_state').selectAll().execute()).toHaveLength(0)
    expect(h.rolled).toHaveLength(0)
  })

  it('激活失败：回滚本次迁移并重启旧版', async () => {
    let v1Entries = 0
    let v2Entries = 0
    const v1 = discoveredOf(
      { id: 'base' },
      {
        onResolveEntry: () => {
          v1Entries += 1
        },
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
        ],
      },
    )
    const h = await startWith(v1)
    const v2 = discoveredOf(
      { id: 'base', version: '2.0.0' },
      {
        failEntryWith: 'v2 boom',
        onResolveEntry: () => {
          v2Entries += 1
        },
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
          {
            pluginId: 'base',
            n: 2,
            name: 'add-label',
            up: 'ALTER TABLE base ADD COLUMN label TEXT;',
            down: 'ALTER TABLE base DROP COLUMN label;',
          },
        ],
      },
    )

    await h.service.update('base', v2)

    expect(h.service.getRecord('base')).toMatchObject({ version: '1.0.0', state: 'active' })
    expect(h.service.getRecord('base')?.failure).toBeUndefined()
    expect(v1Entries).toBe(2)
    expect(v2Entries).toBe(1)
    expect(h.rolled).toHaveLength(1)
    expect(h.rolled[0]).toMatchObject({
      id: 'base',
      reason: 'v2 boom',
      undone: [{ pluginId: 'base', n: 2 }],
    })
    expect(
      (await readLedger(h.db)).filter(row => row.pluginId === 'base').map(row => row.n),
    ).toEqual([1])
    expect(() => h.sqlite.prepare('SELECT label FROM base')).toThrow('no such column: label')
    expect(await h.db.selectFrom('plugin_state').selectAll().execute()).toHaveLength(0)
  })

  it('回滚也失败进入人工恢复态（disabled/rollback 持久化）', async () => {
    const v1 = discoveredOf(
      { id: 'base' },
      {
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
        ],
      },
    )
    const h = await startWith(v1)
    let entries = 0
    const v2 = discoveredOf(
      { id: 'base', version: '2.0.0' },
      {
        failEntryWith: 'v2 boom',
        onResolveEntry: () => {
          entries += 1
        },
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
          {
            pluginId: 'base',
            n: 2,
            name: 'add-label',
            up: 'ALTER TABLE base ADD COLUMN label TEXT;',
            down: 'DROP TABLE missing_table;',
          },
        ],
      },
    )

    await h.service.update('base', v2)

    expect(entries).toBe(1)
    expect(h.service.getRecord('base')).toMatchObject({
      version: '2.0.0',
      state: 'disabled',
      failure: { stage: 'rollback' },
    })
    expect(h.service.getRecord('base')?.failure?.message).toContain('回滚失败')
    const rows = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ plugin_id: 'base', state: 'disabled' })
    expect(rows[0]?.error).toContain('"stage":"rollback"')
    expect(h.rolled).toHaveLength(0)
  })

  it('迁移失败：回滚后旧版保持运行并抛出原始错误', async () => {
    let entries = 0
    const v1 = discoveredOf(
      { id: 'base' },
      {
        onResolveEntry: () => {
          entries += 1
        },
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
        ],
      },
    )
    const h = await startWith(v1)
    const v2 = discoveredOf(
      { id: 'base', version: '2.0.0' },
      {
        migrations: [
          {
            pluginId: 'base',
            n: 1,
            name: 'init',
            up: 'CREATE TABLE base(id INTEGER);',
            down: 'DROP TABLE base;',
          },
          { pluginId: 'base', n: 2, name: 'broken', up: 'CREATE TABLE', down: '' },
        ],
      },
    )

    await expect(h.service.update('base', v2)).rejects.toThrow('incomplete input')
    expect(entries).toBe(1)
    expect(h.service.getRecord('base')).toMatchObject({ version: '1.0.0', state: 'active' })
    expect(h.service.getRecord('base')?.failure).toBeUndefined()
    expect(h.rolled).toHaveLength(1)
    expect(h.rolled[0]).toMatchObject({ id: 'base', undone: [] })
    expect(
      (await readLedger(h.db)).filter(row => row.pluginId === 'base').map(row => row.n),
    ).toEqual([1])
  })

  it('校验失败直接抛错且旧版保持运行', async () => {
    const v1 = discoveredOf({ id: 'base' })
    const h = await startWith(v1)
    const v2 = discoveredOf({ id: 'base', version: '2.0' })
    await expect(h.service.update('base', v2)).rejects.toThrow('version')
    expect(h.service.getRecord('base')).toMatchObject({ version: '1.0.0', state: 'active' })
    expect(await h.db.selectFrom('plugin_state').selectAll().execute()).toHaveLength(0)
  })
})