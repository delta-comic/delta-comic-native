import { describe, expect, it } from 'vitest'

import { EndpointRepository } from '../lib/repository'

import { createTestDb } from './util'

describe('EndpointRepository', () => {
  it('recordProbe 落账并按主键去重更新', async () => {
    const h = await createTestDb()
    const repo = new EndpointRepository(h.db)

    await repo.recordProbe(
      'sample',
      { url: 'https://edge-a.example.test', label: 'A', latencyMs: 120 },
      '2026-08-26T00:00:00.000Z',
    )
    await repo.recordProbe(
      'sample',
      { url: 'https://edge-a.example.test', latencyMs: 90 },
      '2026-08-26T01:00:00.000Z',
    )
    await repo.recordProbe(
      'sample',
      { url: 'https://edge-b.example.test', latencyMs: 200 },
      '2026-08-26T01:00:00.000Z',
    )

    const rows = await repo.listByPlugin('sample')
    expect(rows).toHaveLength(2)
    const a = rows.find(row => row.url === 'https://edge-a.example.test')
    expect(a).toMatchObject({
      label: 'A',
      latencyMs: 90,
      lastOkAt: Date.parse('2026-08-26T01:00:00.000Z'),
      failCount: 0,
    })
    await h.destroy()
  })

  it('recordFailure 自增计数，touch 归零并刷新触达', async () => {
    const h = await createTestDb()
    const repo = new EndpointRepository(h.db)
    await repo.recordProbe(
      'sample',
      { url: 'https://e.test', latencyMs: 50 },
      '2026-08-26T00:00:00.000Z',
    )

    await repo.recordFailure('sample', 'https://e.test', '2026-08-26T00:01:00.000Z')
    await repo.recordFailure('sample', 'https://e.test', '2026-08-26T00:02:00.000Z')
    let row = (await repo.listByPlugin('sample'))[0]
    expect(row?.failCount).toBe(2)
    expect(row?.lastOkAt).toBe(Date.parse('2026-08-26T00:00:00.000Z'))

    await repo.touch('sample', 'https://e.test', '2026-08-26T00:03:00.000Z')
    row = (await repo.listByPlugin('sample'))[0]
    expect(row?.failCount).toBe(0)
    expect(row?.lastOkAt).toBe(Date.parse('2026-08-26T00:03:00.000Z'))
    expect(row?.latencyMs).toBe(50)
    await h.destroy()
  })

  it('pruneStale 清理从未成功与过期行，removeExcept 收缩集合', async () => {
    const h = await createTestDb()
    const repo = new EndpointRepository(h.db)
    await repo.recordProbe(
      'sample',
      { url: 'https://fresh.test', latencyMs: 10 },
      '2026-08-26T05:00:00.000Z',
    )
    await repo.recordProbe(
      'sample',
      { url: 'https://old.test', latencyMs: 20 },
      '2026-08-25T00:00:00.000Z',
    )
    await repo.removeExcept('sample', ['https://fresh.test', 'https://old.test'])

    await repo.pruneStale('sample', '2026-08-26T00:00:00.000Z')
    let urls = (await repo.listByPlugin('sample')).map(row => row.url)
    expect(urls).toEqual(['https://fresh.test'])

    await repo.recordProbe(
      'sample',
      { url: 'https://gone.test', latencyMs: 30 },
      '2026-08-26T05:00:00.000Z',
    )
    await repo.removeExcept('sample', ['https://fresh.test'])
    urls = (await repo.listByPlugin('sample')).map(row => row.url)
    expect(urls).toEqual(['https://fresh.test'])
    await h.destroy()
  })
})