import type { Edge } from '@delta-comic/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EdgeRouterService,
  NoEdgeAvailableError,
  type EdgeRouterSnapshot,
} from '../lib/service'
import type { ProbeRace, RankedEndpoint } from '../lib/probe'
import { createContext, createTestDb, flush, type TestDb } from './util'

interface ProbeSpec {
  readonly edge: Edge
  /** 上报用的延迟值（与真实结算顺序解耦）。 */
  readonly latencyMs: number
  readonly fail?: boolean
  /** 实际结算延迟毫秒，模拟慢端点后胜。 */
  readonly delay?: number
}

const edge = (baseUrl: string, label?: string): Edge => ({ baseUrl, label })

/** 立即出结果的确定性竞速：按声明顺序兑现，fail 项按序拒绝。 */
function raceOf(specs: readonly ProbeSpec[]): ProbeRace {
  const attempts = specs.map(spec =>
    new Promise<RankedEndpoint>((resolve, reject) => {
      const settle = () =>
        spec.fail === true
          ? reject(new Error(`down: ${spec.edge.baseUrl}`))
          : resolve({ edge: spec.edge, latencyMs: spec.latencyMs })
      const delay = spec.delay ?? 0
      if (delay === 0) settle()
      else setTimeout(settle, delay)
    }),
  )
  const whenFirst = Promise.any(attempts)
  // 未被消费的竞速对象（如队列中未用到的轮次）拒绝时避免全局未处理告警。
  whenFirst.catch(() => {})
  return {
    whenFirst,
    whenSettled: Promise.allSettled(attempts).then(results =>
      results
        .flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
        .sort((a, b) => a.latencyMs - b.latencyMs),
    ),
  }
}

interface Harness {
  db: TestDb
  ctx: ReturnType<typeof createContext>
  service: EdgeRouterService
  probeCalls: number
  races: ProbeRace[]
  events: { pluginId: string; edge: Edge | null }[]
  seedRow(row: {
    pluginId: string
    url: string
    latencyMs: number | null
    lastOkAtIso: string | null
  }): Promise<void>
}

async function createHarness(): Promise<Harness> {
  const h: Harness = {
    db: await createTestDb(),
    ctx: createContext(),
    service: undefined as unknown as EdgeRouterService,
    probeCalls: 0,
    races: [],
    events: [],
    seedRow: async () => {},
  }
  h.service = new EdgeRouterService(h.ctx, h.db.db, {
    prober: edges => {
      const race = h.races[h.probeCalls]
      if (race === undefined) throw new Error(`意外的第 ${h.probeCalls + 1} 轮探测`)
      h.probeCalls += 1
      void edges
      return race
    },
  })
  h.ctx.on('protocol/edge-changed', payload => {
    h.events.push(payload)
  })
  h.seedRow = async row => {
    await h.db.db
      .insertInto('plugin_endpoint')
      .values({
        plugin_id: row.pluginId,
        url: row.url,
        label: null,
        latency_ms: row.latencyMs,
        last_ok_at: row.lastOkAtIso,
        fail_count: 0,
        updated_at: '2026-08-26T06:00:00.000Z',
      })
      .execute()
  }
  return h
}

const NOW_ISO = () => new Date().toISOString()

describe('EdgeRouterService', () => {
  let h: Harness

  beforeEach(async () => {
    h = await createHarness()
  })

  afterEach(async () => {
    vi.useRealTimers()
    await h.db.destroy()
  })

  it('冷启动 TTL 内复用选中免探', async () => {
    await h.seedRow({
      pluginId: 'sample',
      url: 'https://a.test',
      latencyMs: 300,
      lastOkAtIso: NOW_ISO(),
    })
    await h.seedRow({
      pluginId: 'sample',
      url: 'https://b.test',
      latencyMs: 100,
      lastOkAtIso: NOW_ISO(),
    })

    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [],
    })
    await flush()
    expect(h.probeCalls).toBe(0)
    expect(h.service.current('sample')).toEqual({ baseUrl: 'https://b.test' })
    expect(h.events[0]).toEqual({ pluginId: 'sample', edge: { baseUrl: 'https://b.test' } })
    expect(await h.service.ensureSelected('sample')).toEqual({ baseUrl: 'https://b.test' })
  })

  it('TTL 过期不复用且清理过期行', async () => {
    await h.seedRow({
      pluginId: 'sample',
      url: 'https://stale.test',
      latencyMs: 100,
      lastOkAtIso: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
    })
    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://stale.test')],
    })
    await flush()
    expect(h.service.current('sample')).toBeNull()
    expect(await h.db.db.selectFrom('plugin_endpoint').selectAll().execute()).toHaveLength(0)
  })

  it('ensureSelected 触发竞速并落账全部成功候选', async () => {
    h.races.push(
      raceOf([
        { edge: edge('https://slow.test'), latencyMs: 400, delay: 30 },
        { edge: edge('https://fast.test', 'F'), latencyMs: 80, delay: 1 },
      ]),
    )
    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://slow.test/'), edge('https://fast.test')],
    })
    await flush()

    const selected = await h.service.ensureSelected('sample')
    expect(selected).toEqual({ baseUrl: 'https://fast.test', label: 'F' })
    expect(h.events.map(event => event.edge?.baseUrl)).toContain('https://fast.test')

    await flush()
    // 慢端点的结算延迟为 30ms 真实时间，等待全量排名落账。
    await new Promise(resolve => setTimeout(resolve, 40))
    const rows = await h.db.db.selectFrom('plugin_endpoint').selectAll().execute()
    expect(rows).toHaveLength(2)
    const fast = rows.find(row => row.url === 'https://fast.test')
    expect(fast).toMatchObject({ latency_ms: 80, fail_count: 0 })
    // resolveEdges 归一化去掉了尾部斜杠，慢端点也持久化。
    expect(rows.some(row => row.url === 'https://slow.test')).toBe(true)

    const snapshot: EdgeRouterSnapshot[] = [...h.service.snapshot()]
    expect(snapshot[0]).toMatchObject({
      pluginId: 'sample',
      status: 'ready',
      selected: { baseUrl: 'https://fast.test' },
    })
  })

  it('resolveEdges 抛错转 failed 并按退避自动重探', async () => {
    vi.useFakeTimers()
    h.races.push(
      raceOf([{ edge: edge('https://x.test'), latencyMs: 10, fail: true }]),
      raceOf([{ edge: edge('https://y.test'), latencyMs: 20 }]),
    )
    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://x.test')],
    })

    await expect(h.service.ensureSelected('sample')).rejects.toMatchObject({
      code: 'no-edge-available',
    })
    expect(h.probeCalls).toBe(1)
    expect(h.service.current('sample')).toBeNull()
    expect(h.events.at(-1)).toMatchObject({ pluginId: 'sample', edge: null })

    vi.advanceTimersByTime(29_999)
    await flush()
    expect(h.probeCalls).toBe(1)
    vi.advanceTimersByTime(1)
    await flush()
    expect(h.probeCalls).toBe(2)
    await expect(h.service.ensureSelected('sample')).resolves.toEqual({ baseUrl: 'https://y.test' })
  })

  it('withFailover 标记失败切次优并重调一次', async () => {
    h.races.push(
      raceOf([{ edge: edge('https://a.test'), latencyMs: 100 }, { edge: edge('https://b.test'), latencyMs: 200 }]),
    )
    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://a.test'), edge('https://b.test')],
    })
    await h.service.ensureSelected('sample')
    expect(h.service.current('sample')).toEqual({ baseUrl: 'https://a.test' })

    const seenUrls: string[] = []
    const result = await h.service.withFailover('sample', async used => {
      seenUrls.push(used.baseUrl)
      if (used.baseUrl === 'https://a.test') throw new Error('上游 502')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(seenUrls).toEqual(['https://a.test', 'https://b.test'])
    expect(h.service.current('sample')).toEqual({ baseUrl: 'https://b.test' })
    await flush()
    const aRow = (await h.db.db.selectFrom('plugin_endpoint').selectAll().execute()).find(
      row => row.url === 'https://a.test',
    )
    expect(aRow?.fail_count).toBeGreaterThanOrEqual(1)
  })

  it('report(false) 无次优时广播 null 并后台重探恢复', async () => {
    h.races.push(
      raceOf([{ edge: edge('https://only.test'), latencyMs: 10 }]),
      raceOf([{ edge: edge('https://revived.test'), latencyMs: 30 }]),
    )
    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://only.test')],
    })
    await h.service.ensureSelected('sample')

    h.races.push(raceOf([{ edge: edge('https://revived.test'), latencyMs: 30 }]))
    h.service.report('sample', 'https://only.test/', false)
    expect(h.service.current('sample')).toBeNull()
    expect(h.events.at(-1)).toMatchObject({ edge: null })

    await flush()
    expect(h.probeCalls).toBe(2)
    expect(h.service.current('sample')).toEqual({ baseUrl: 'https://revived.test' })
  })

  it('report(true) 刷新触达；resolve 补全路径与绝对 URL 直通', async () => {
    h.races.push(raceOf([{ edge: edge('https://base.test'), latencyMs: 10 }]))
    h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://base.test')],
    })
    await h.service.ensureSelected('sample')
    h.service.report('sample', 'https://base.test', true)
    await flush()
    const row = (await h.db.db.selectFrom('plugin_endpoint').selectAll().execute())[0]
    expect(row?.last_ok_at).not.toBeNull()

    expect(h.service.resolve('sample', 'img/a.jpg')).toBe('https://base.test/img/a.jpg')
    expect(h.service.resolve('sample', '/img/b.jpg')).toBe('https://base.test/img/b.jpg')
    expect(h.service.resolve('sample', 'https://cdn.example.test/x.jpg')).toBe(
      'https://cdn.example.test/x.jpg',
    )
  })

  it('detach 广播 null 且后续调用拒绝；重复 attach 抛错', async () => {
    h.races.push(raceOf([{ edge: edge('https://a.test'), latencyMs: 10 }]))
    const dispose = h.service.attach({
      pluginId: 'sample',
      version: '1.0.0',
      pluginContext: h.ctx,
      resolveEdges: async () => [edge('https://a.test')],
    })
    await h.service.ensureSelected('sample')

    expect(() =>
      h.service.attach({
        pluginId: 'sample',
        version: '1.0.0',
        pluginContext: h.ctx,
        resolveEdges: async () => [],
      }),
    ).toThrow('重复附加')

    dispose()
    expect(h.service.current('sample')).toBeNull()
    expect(h.events.at(-1)).toMatchObject({ pluginId: 'sample', edge: null })
    await expect(h.service.ensureSelected('sample')).rejects.toBeInstanceOf(NoEdgeAvailableError)
  })

  it('ensureSelected 未附加插件直接拒绝', async () => {
    await expect(h.service.ensureSelected('ghost')).rejects.toMatchObject({
      code: 'no-edge-available',
    })
  })
})
