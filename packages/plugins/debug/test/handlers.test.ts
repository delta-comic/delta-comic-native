import { describe, expect, it } from 'vitest'

import { attachDebugCapture } from '../lib/capture'
import { buildHandlers } from '../lib/handlers'
import { assertReadOnlySql, DebugToolError } from '../lib/handlers'

import { createFixture } from './fixture'

declare module 'cordis' {
  interface Events {
    /** 测试事件。 @mode emit */
    'sample/event'(payload: { value: number }): void
  }
}

async function harness() {
  const fixture = await createFixture()
  const capture = attachDebugCapture(fixture.ctx)
  const handlers = buildHandlers(
    {
      appId: 'test-device',
      platform: 'ios',
      appVersion: '1.0.0',
      hostVersion: '1.0.0',
      db: fixture.db,
      loader: fixture.loader,
      routeRegistry: fixture.routeRegistry,
      uiRegistry: fixture.uiRegistry,
      navigation: fixture.navigation,
    },
    capture,
  )
  return { ...fixture, handlers }
}

describe('观察工具', () => {
  it('app_info 返回设备投影', async () => {
    const h = await harness()
    expect(await h.handlers.app_info({})).toEqual({
      appId: 'test-device',
      platform: 'ios',
      appVersion: '1.0.0',
      hostVersion: '1.0.0',
      dev: true,
    })
  })

  it('plugin_list / plugin_detail 投影加载记录与 manifest', async () => {
    const h = await harness()
    const list = (await h.handlers.plugin_list({})) as { plugins: { id: string; state: string }[] }
    expect(list.plugins.map(plugin => plugin.id).sort()).toEqual(['sample'])
    expect(list.plugins[0]?.state).toBe('active')

    const detail = (await h.handlers.plugin_detail({ id: 'sample' })) as {
      found: boolean
      record?: { id: string }
      manifest?: { id: string }
    }
    expect(detail.found).toBe(true)
    expect(detail.record?.id).toBe('sample')
    expect(detail.manifest?.id).toBe('sample')
    expect(await h.handlers.plugin_detail({ id: 'missing' })).toEqual({ found: false })
  })

  it('db_schema 列出表结构与 ledger', async () => {
    const h = await harness()
    const schema = (await h.handlers.db_schema({})) as {
      tables: { name: string; ddl: string }[]
      ledger: { pluginId: string }[]
    }
    expect(schema.tables.map(table => table.name)).toContain('sample')
    expect(schema.tables.find(table => table.name === 'sample')?.ddl).toContain('CREATE TABLE')
    expect(schema.ledger.map(entry => entry.pluginId)).toContain('sample')
  })

  it('db_query 执行只读查询并按 limit 截断', async () => {
    const h = await harness()
    await h.db.executeQuery(
      h.db
        .insertInto('sample' as never)
        .values([
          { id: 1, label: 'a' },
          { id: 2, label: 'b' },
          { id: 3, label: 'c' },
        ])
        .compile(),
    )
    const result = (await h.handlers.db_query({
      sql: 'SELECT id, label FROM sample ORDER BY id',
      limit: 2,
    })) as { rows: Record<string, unknown>[]; truncated: boolean }
    expect(result.rows).toEqual([
      { id: 1, label: 'a' },
      { id: 2, label: 'b' },
    ])
    expect(result.truncated).toBe(true)
  })

  it('db_query 拒绝写语句与多语句', async () => {
    const h = await harness()
    for (const sql of [
      'DELETE FROM sample',
      'INSERT INTO sample VALUES (1)',
      "UPDATE sample SET label = 'x'",
      'SELECT 1; SELECT 2',
    ]) {
      await expect(h.handlers.db_query({ sql })).rejects.toThrow(DebugToolError)
    }
  })

  it('registry_list 返回路由 key 与 UI 分层条目', async () => {
    const h = await harness()
    expect(await h.handlers.registry_list({})).toEqual({
      routes: ['core/detail'],
      ui: [{ key: 'ui/banner', items: [{ id: 'core', version: '1.0.0', priority: 0 }] }],
    })
  })

  it('logs_tail/logs_search/events_recent 从环形缓冲过滤', async () => {
    const h = await harness()
    h.ctx.logger.error('%s 失败：%d', '网络', 500)
    h.ctx.emit('sample/event', { value: 1 })

    const tail = (await h.handlers.logs_tail({ limit: 10, level: 'error' })) as {
      entries: { level: string; scope: string }[]
    }
    expect(tail.entries.length).toBe(1)
    expect(tail.entries[0]).toMatchObject({ level: 'error' })
    expect(typeof tail.entries[0]?.scope).toBe('string')

    const search = (await h.handlers.logs_search({ query: '失败' })) as { entries: unknown[] }
    expect(search.entries).toHaveLength(1)

    const events = (await h.handlers.events_recent({ name: 'sample/' })) as {
      events: { name: string; mode: string }[]
    }
    expect(events.events[0]).toMatchObject({ name: 'sample/event', mode: 'emit' })
  })

  it('diagnostics_export 输出 JSON 报告字符串', async () => {
    const h = await harness()
    const result = (await h.handlers.diagnostics_export({})) as { report: string }
    const report = JSON.parse(result.report) as { app: { appId: string }; plugins: unknown[] }
    expect(report.app.appId).toBe('test-device')
    expect(report.plugins).toHaveLength(1)
  })
})

describe('操控工具', () => {
  it('navigate 校验注册表后透传命令面', async () => {
    const h = await harness()
    await expect(h.handlers.navigate({ key: 'nope/detail' })).rejects.toThrow(DebugToolError)
    await h.handlers.navigate({ key: 'core/detail', params: { q: 1 } })
    expect(h.navigateCalls).toEqual([['core/detail']])
  })

  it('plugin_reload 重载 active 插件、plugin_disable 停用并落盘', async () => {
    const h = await harness()
    await h.handlers.plugin_reload({ id: 'sample' })
    expect(h.loader.getRecord('sample')).toMatchObject({ state: 'active' })

    await h.handlers.plugin_disable({ id: 'sample' })
    expect(h.loader.getRecord('sample')).toMatchObject({ state: 'disabled' })
    const rows = await h.db.selectFrom('plugin_state').selectAll().execute()
    expect(rows.find(row => row.plugin_id === 'sample')).toMatchObject({ state: 'disabled' })
  })

  it('plugin_enable 对 disabled 插件重走激活', async () => {
    const h = await harness()
    await h.handlers.plugin_disable({ id: 'sample' })
    await h.handlers.plugin_enable({ id: 'sample' })
    expect(h.loader.getRecord('sample')).toMatchObject({ state: 'active' })
  })
})

describe('assertReadOnlySql', () => {
  it('接受 WITH/SELECT 与尾分号，大小写不敏感', () => {
    expect(assertReadOnlySql('select 1')).toBe('select 1')
    expect(assertReadOnlySql('WITH t AS (SELECT 1) SELECT * FROM t;')).toBe(
      'WITH t AS (SELECT 1) SELECT * FROM t',
    )
    expect(assertReadOnlySql('  SELECT  ; ')).toBe('SELECT')
  })

  it('非只读或多语句抛 DebugToolError', () => {
    expect(() => assertReadOnlySql('pragma table_info(sample)')).toThrow(DebugToolError)
    expect(() => assertReadOnlySql('select 1; drop table sample')).toThrow(DebugToolError)
  })
})