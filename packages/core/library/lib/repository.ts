/**
 * 用户域持久化仓库：裸 Kysely 操作 CoreDatabase（resource / social 仓库同款先例）。
 *
 * - HistoryRepository：item_history 行级读写，(item_id) 主键 upsert
 * - ShelfRepository：shelf_item 行级读写，(kind, item_id) 唯一约束
 */
import type { CoreDatabase, ItemHistoryRow, ShelfItemRow } from '@delta-comic/db'
import type { Kysely } from 'kysely'

export interface HistoryRecord {
  readonly itemId: string
  readonly title: string
  readonly playerKey: string
  readonly payloadJson: string
  readonly progressJson: string | null
  readonly progressRatio: number | null
  readonly openedCount: number
  readonly firstOpenedAt: string
  readonly lastOpenedAt: string
}

const toHistory = (row: ItemHistoryRow): HistoryRecord => ({
  itemId: row.item_id,
  title: row.title,
  playerKey: row.player_key,
  payloadJson: row.payload_json,
  progressJson: row.progress_json,
  progressRatio: row.progress_ratio,
  openedCount: row.opened_count,
  firstOpenedAt: row.first_opened_at,
  lastOpenedAt: row.last_opened_at,
})

export class HistoryRepository {
  constructor(private readonly db: Kysely<CoreDatabase>) {}

  async get(itemId: string): Promise<HistoryRecord | undefined> {
    const row = await this.db
      .selectFrom('item_history')
      .selectAll()
      .where('item_id', '=', itemId)
      .executeTakeFirst()
    return row === undefined ? undefined : toHistory(row)
  }

  /** (item_id) 冲突时刷新展示与进度字段，first_opened_at 与 opened_count 由调用方给全量值。 */
  async upsert(record: HistoryRecord): Promise<void> {
    const values = {
      item_id: record.itemId,
      title: record.title,
      player_key: record.playerKey,
      payload_json: record.payloadJson,
      progress_json: record.progressJson,
      progress_ratio: record.progressRatio,
      opened_count: record.openedCount,
      first_opened_at: record.firstOpenedAt,
      last_opened_at: record.lastOpenedAt,
    }
    await this.db
      .insertInto('item_history')
      .values(values)
      .onConflict(oc =>
        oc.columns(['item_id']).doUpdateSet({
          title: values.title,
          player_key: values.player_key,
          payload_json: values.payload_json,
          progress_json: values.progress_json,
          progress_ratio: values.progress_ratio,
          opened_count: values.opened_count,
          last_opened_at: values.last_opened_at,
        }),
      )
      .execute()
  }

  async updateProgress(
    itemId: string,
    patch: { readonly progressJson: string | null; readonly progressRatio: number | null },
  ): Promise<void> {
    await this.db
      .updateTable('item_history')
      .set({ progress_json: patch.progressJson, progress_ratio: patch.progressRatio })
      .where('item_id', '=', itemId)
      .execute()
  }

  /** 按 last_opened_at 倒序；limit 提供时截断。 */
  async list(limit?: number): Promise<readonly HistoryRecord[]> {
    let query = this.db
      .selectFrom('item_history')
      .selectAll()
      .orderBy('last_opened_at', 'desc')
      .orderBy('item_id', 'desc')
    if (limit !== undefined) query = query.limit(limit)
    const rows = await query.execute()
    return rows.map(toHistory)
  }

  async remove(itemId: string): Promise<void> {
    await this.db.deleteFrom('item_history').where('item_id', '=', itemId).execute()
  }

  async clear(): Promise<void> {
    await this.db.deleteFrom('item_history').execute()
  }
}

export type ShelfKind = 'favorite' | 'later'

export interface ShelfRecord {
  readonly id: string
  readonly kind: ShelfKind
  readonly itemId: string
  readonly title: string
  readonly playerKey: string
  readonly payloadJson: string
  readonly createdAt: string
  readonly updatedAt: string
}

const isShelfKind = (value: string): value is ShelfKind =>
  value === 'favorite' || value === 'later'

const toShelf = (row: ShelfItemRow): ShelfRecord | undefined => {
  if (!isShelfKind(row.kind)) return undefined
  return {
    id: row.id,
    kind: row.kind,
    itemId: row.item_id,
    title: row.title,
    playerKey: row.player_key,
    payloadJson: row.payload_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ShelfRepository {
  constructor(private readonly db: Kysely<CoreDatabase>) {}

  async insert(record: ShelfRecord): Promise<void> {
    await this.db
      .insertInto('shelf_item')
      .values({
        id: record.id,
        kind: record.kind,
        item_id: record.itemId,
        title: record.title,
        player_key: record.playerKey,
        payload_json: record.payloadJson,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })
      .execute()
  }

  async get(id: string): Promise<ShelfRecord | undefined> {
    const row = await this.db
      .selectFrom('shelf_item')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row === undefined ? undefined : toShelf(row)
  }

  async findByTarget(kind: ShelfKind, itemId: string): Promise<ShelfRecord | undefined> {
    const row = await this.db
      .selectFrom('shelf_item')
      .selectAll()
      .where(eb => eb.and([eb('kind', '=', kind), eb('item_id', '=', itemId)]))
      .executeTakeFirst()
    return row === undefined ? undefined : toShelf(row)
  }

  /** kind 提供时过滤；按 created_at 倒序、id 倒序稳定排列。 */
  async list(kind?: ShelfKind): Promise<readonly ShelfRecord[]> {
    let query = this.db
      .selectFrom('shelf_item')
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
    if (kind !== undefined) query = query.where('kind', '=', kind)
    const rows = await query.execute()
    return rows.map(toShelf).filter(record => record !== undefined)
  }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('shelf_item').where('id', '=', id).execute()
  }
}
