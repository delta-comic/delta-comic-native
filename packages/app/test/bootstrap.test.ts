/**
 * 宿主装配测试：node:sqlite 内存库 + zip 来源（runtime fixture），
 * 验证 createApp 全链路——服务挂载、插件激活、capability 授权、dispose 干净。
 */
import { DatabaseSync } from 'node:sqlite'

import { applyMigrations, coreMigrations } from '@delta-comic/db'
import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import type { LoaderDatabase } from '@delta-comic/loader'
import { hashOf } from '@delta-comic/runtime'
import { Context } from 'cordis'
import { strToU8, zipSync } from 'fflate'
import { Kysely } from 'kysely'
import { describe, expect, it } from 'vitest'

import { createApp } from '../lib/bootstrap.ts'
import type { HostSeams } from '../lib/platform.ts'
import { createZipDirSource } from '../lib/sources.ts'

function makeTestDb(): Kysely<LoaderDatabase> {
  const sqlite = new DatabaseSync(':memory:')
  return new Kysely<LoaderDatabase>({ dialect: nodeSqliteDialectFrom(sqlite) })
}

/** 与 runtime 测试同形的合法 fixture 插件包。 */
function makePluginZip(capabilities: readonly string[]): Uint8Array {
  const entry = 'export default { apply() {} }\n'
  const manifest = {
    id: 'demo',
    version: '1.0.0',
    hostVersion: '>=1.0.0',
    entries: { common: { path: 'common/index.js', sha256: hashOf(strToU8(entry)) } },
    runtime: {
      rn: '^0.87.0',
      hermes: '^2026.1.0',
      bytecode: 96,
      cpu: ['arm64'],
      compileOptions: { dev: 'false' },
    },
    network: { multiEdge: false },
    capabilities,
  }
  return zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'common/index.js': strToU8(entry),
  })
}

const evaluator = Object.assign(async () => ({ default: { apply() {} } }), {})

function seamsOf(zips: Record<string, Uint8Array>): HostSeams {
  return {
    platform: 'web',
    createDb: async () => makeTestDb(),
    evaluator,
    sources: [
      createZipDirSource({
        stage: 'official',
        dir: '',
        platform: 'web',
        evaluator,
        onError: (name, cause) => console.error('DISCOVER_FAIL', name, cause),
        fs: {
          listZips: async () => Object.keys(zips),
          readFile: async name => {
            const bytes = zips[name]
            if (bytes === undefined) throw new Error(`缺失：${name}`)
            return bytes
          },
        },
      }),
    ],
  }
}

describe('createApp', () => {
  it('装配核心服务并激活来源内插件', async () => {
    const app = await createApp(new Context(), seamsOf({ 'demo.zip': makePluginZip([]) }))
    try {
      const records = app.ctx.pluginLoader.diagnostics()
      expect(records).toHaveLength(1)
      expect(records[0]?.state).toBe('active')
      // 核心服务可达
      expect(app.ctx.scheduler.snapshot().queued).toEqual([])
    } finally {
      await app.dispose()
    }
  })

  it('verified 即按 manifest.capabilities 授权（先于激活）', async () => {
    const app = await createApp(
      new Context(),
      seamsOf({ 'demo.zip': makePluginZip(['dev-debug']) }),
    )
    try {
      expect(app.ctx.capability.capabilitiesOf('demo')).toEqual(['dev-debug'])
    } finally {
      await app.dispose()
    }
  })

  it('dispose 后 fiber 与数据库均关闭', async () => {
    const db = makeTestDb()
    const ctx = new Context()
    const app = await createApp(ctx, { ...seamsOf({}), createDb: async () => db })
    await app.dispose()
    await expect(db.selectFrom('plugin_state').selectAll().execute()).rejects.toBeTruthy()
  })

  it('宿主库迁移链可用（core/5）', async () => {
    const db = makeTestDb()
    await applyMigrations(db, coreMigrations)
    const ledger = await db.selectFrom('migration_ledger').selectAll().execute()
    expect(ledger.some(row => row.plugin_id === 'core' && row.n === 5)).toBe(true)
  })
})