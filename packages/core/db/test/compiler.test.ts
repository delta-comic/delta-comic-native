import { describe, expect, it } from 'vitest'

import { defineTable, integer, real, text, textNotNull } from '../lib/dsl'
import { snapshotOf } from '../lib/snapshot'
import { compileMigration } from '../lib/sql'

const comicV1 = [
  defineTable('comic', {
    columns: { id: textNotNull(), title: textNotNull() },
    primaryKey: ['id'],
    indexes: [{ columns: ['title'] }],
  }),
]

describe('snapshot -> SQL 编译器', () => {
  it('初始建表生成 CREATE TABLE 与确定性索引名，down 为空', () => {
    const result = compileMigration(null, snapshotOf(comicV1))
    expect(result.up.join('\n')).toContain('CREATE TABLE "comic"')
    expect(result.up.join('\n')).toContain('PRIMARY KEY ("id")')
    expect(result.up.join('\n')).toContain(
      'CREATE INDEX IF NOT EXISTS "idx_comic_title" ON "comic" ("title")',
    )
    expect(result.plan.items.every(item => item.category === 'additive')).toBe(true)
    expect(result.down).toEqual([])
  })

  it('新增可空列走 ALTER ADD', () => {
    const comicV2 = [
      defineTable('comic', {
        columns: { id: textNotNull(), title: textNotNull(), rating: real() },
        primaryKey: ['id'],
        indexes: [{ columns: ['title'] }],
      }),
    ]
    const result = compileMigration(snapshotOf(comicV1), snapshotOf(comicV2))
    expect(result.up).toContain('ALTER TABLE "comic" ADD COLUMN "rating" REAL')
  })

  it('ADD COLUMN 声明 NOT NULL 缺 default 显式抛错', () => {
    const comicV2 = [
      defineTable('comic', {
        columns: { id: textNotNull(), title: textNotNull(), source: text().notNull() },
        primaryKey: ['id'],
        indexes: [{ columns: ['title'] }],
      }),
    ]
    expect(() => compileMigration(snapshotOf(comicV1), snapshotOf(comicV2))).toThrow(/NOT NULL/)
  })

  it('列类型与主键变更判为 rebuild 并生成拷贝序列', () => {
    const comicV2 = [
      defineTable('comic', {
        columns: { id: textNotNull(), title: textNotNull(), rating: integer() },
        primaryKey: ['id'],
        indexes: [{ columns: ['title'] }],
      }),
    ]
    const withRating = [
      defineTable('comic', {
        columns: { id: textNotNull(), title: textNotNull(), rating: real() },
        primaryKey: ['id'],
        indexes: [{ columns: ['title'] }],
      }),
    ]
    const result = compileMigration(snapshotOf(withRating), snapshotOf(comicV2))
    expect(result.plan.items).toMatchObject([
      { category: 'rebuild', op: 'rebuildTable', table: 'comic' },
    ])
    const sql = result.up.join('\n')
    expect(sql).toContain('"comic__rebuild"')
    expect(sql).toContain('INSERT INTO')
    expect(sql).toContain('DROP TABLE "comic"')
    expect(sql).toContain('ALTER TABLE "comic__rebuild" RENAME TO "comic"')
  })

  it('删表删列为 destructive 且 down 可回滚', () => {
    const onlyTitle = [
      defineTable('legacy', { columns: { id: textNotNull(), note: text() }, primaryKey: ['id'] }),
    ]
    const forward = compileMigration(snapshotOf(onlyTitle), snapshotOf(comicV1))
    expect(forward.plan.items.some(item => item.op === 'createTable')).toBe(true)
    const backward = compileMigration(snapshotOf(comicV1), snapshotOf(onlyTitle))
    expect(
      backward.plan.items.filter(item => item.category === 'destructive').length,
    ).toBeGreaterThan(0)
    expect(backward.up.join('\n')).toContain('DROP TABLE')
  })
})