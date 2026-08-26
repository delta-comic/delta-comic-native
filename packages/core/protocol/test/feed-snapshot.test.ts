import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import { parseItemSnapshot, serializeItemSnapshot, type Item } from '@delta-comic/protocol'

const testSchema = () => Type.Object({})

declare module '@delta-comic/protocol' {
  interface PlayerInputRegistry {
    'sample/player': { schema: ReturnType<typeof testSchema>; version: '1' }
  }
}

const sampleItem: Item = {
  id: 'item-1',
  title: '第一话',
  preview: { kind: 'image', ref: 'https://example.com/cover.png' },
  playerKey: 'sample/player',
  sourceRefs: [{ sourceId: 'source-a', externalId: 'ch-1' }],
  creatorRefs: [{ creatorId: 'creator-1', displayName: '作者' }],
  viewCount: 1200,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
}

describe('Item 快照序列化边界', () => {
  it('serialize 后 parse 还原全部字段', () => {
    expect(parseItemSnapshot(serializeItemSnapshot(sampleItem))).toEqual({
      id: 'item-1',
      title: '第一话',
      preview: { kind: 'image', ref: 'https://example.com/cover.png' },
      playerKey: 'sample/player',
      sourceRefs: [{ sourceId: 'source-a', externalId: 'ch-1' }],
      creatorRefs: [{ creatorId: 'creator-1', displayName: '作者' }],
      viewCount: 1200,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
    })
  })

  it('非法 JSON 与非对象值返回 undefined', () => {
    expect(parseItemSnapshot('{')).toBeUndefined()
    expect(parseItemSnapshot('null')).toBeUndefined()
    expect(parseItemSnapshot('42')).toBeUndefined()
    expect(parseItemSnapshot('"text"')).toBeUndefined()
  })

  it('字段缺失或类型不符返回 undefined', () => {
    const withoutTitle: Record<string, unknown> = { ...sampleItem }
    delete withoutTitle.title
    expect(parseItemSnapshot(JSON.stringify(withoutTitle))).toBeUndefined()

    expect(parseItemSnapshot(JSON.stringify({ ...sampleItem, createdAt: 'late' }))).toBeUndefined()
    expect(
      parseItemSnapshot(JSON.stringify({ ...sampleItem, sourceRefs: [{ sourceId: 'a' }] })),
    ).toBeUndefined()
    expect(
      parseItemSnapshot(JSON.stringify({ ...sampleItem, preview: { kind: 'image' } })),
    ).toBeUndefined()
    expect(
      parseItemSnapshot(JSON.stringify({ ...sampleItem, creatorRefs: [{ creatorId: 'c' }] })),
    ).toBeUndefined()
  })
})
