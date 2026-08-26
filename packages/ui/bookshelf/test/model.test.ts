import type { HistoryEntry } from '@delta-comic/library'
import { describe, expect, it } from 'vitest'

import { partitionHistory } from '../lib/model'

function entry(partial: Pick<HistoryEntry, 'itemId'> & Partial<HistoryEntry>): HistoryEntry {
  return {
    title: partial.itemId,
    playerKey: 'sample/player',
    openedCount: 1,
    firstOpenedAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('partitionHistory', () => {
  it('按归一化进度拆分继续消费与最近打开', () => {
    const entries = [
      entry({ itemId: 'a' }),
      entry({ itemId: 'b', progressRatio: 0.5 }),
      entry({ itemId: 'c', progressRatio: 0 }),
      entry({ itemId: 'd', progressJson: '{"page":3}' }),
    ]
    const partitions = partitionHistory(entries)
    expect(partitions.continuing.map(e => e.itemId)).toEqual(['b', 'c'])
    expect(partitions.recent.map(e => e.itemId)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('空输入返回空分区', () => {
    expect(partitionHistory([])).toEqual({ continuing: [], recent: [] })
  })
})