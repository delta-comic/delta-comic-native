/**
 * 关注域持久化仓库：裸 Kysely 操作 CoreDatabase（resource 仓库同款先例）。
 *
 * - SubscriptionGroupRepository：关注分组行级 CRUD 与排序键分配
 * - SubscriptionRepository：订阅行级 CRUD，(target_kind, target_id) 唯一约束
 */
import type { CoreDatabase, SubscriptionGroupRow, SubscriptionRow } from '@delta-comic/db'
import type { Kysely } from 'kysely'

export interface SubscriptionGroupEntity {
  readonly id: string
  readonly title: string
  readonly sortKey: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface SubscriptionEntity {
  readonly id: string
  readonly targetKind: string
  readonly targetId: string
  readonly groupId: string
  readonly sortKey: number
  readonly createdAt: string
  readonly updatedAt: string
}

const toGroup = (row: SubscriptionGroupRow): SubscriptionGroupEntity => ({
  id: row.id,
  title: row.title,
  sortKey: row.sort_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toSubscription = (row: SubscriptionRow): SubscriptionEntity => ({
  id: row.id,
  targetKind: row.target_kind,
  targetId: row.target_id,
  groupId: row.group_id,
  sortKey: row.sort_key,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SubscriptionGroupRepository {
  constructor(private readonly db: Kysely<CoreDatabase>) {}

  async insert(group: SubscriptionGroupEntity): Promise<void> {
    await this.db
      .insertInto('subscription_group')
      .values({
        id: group.id,
        title: group.title,
        sort_key: group.sortKey,
        created_at: group.createdAt,
        updated_at: group.updatedAt,
      })
      .execute()
  }

  async get(id: string): Promise<SubscriptionGroupEntity | undefined> {
    const row = await this.db
      .selectFrom('subscription_group')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row === undefined ? undefined : toGroup(row)
  }

  /** 全部分组，按 sort_key 升序、id 升序稳定排列。 */
  async list(): Promise<readonly SubscriptionGroupEntity[]> {
    const rows = await this.db
      .selectFrom('subscription_group')
      .selectAll()
      .orderBy('sort_key', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map(toGroup)
  }

  async rename(id: string, title: string, updatedAt: string): Promise<void> {
    await this.db
      .updateTable('subscription_group')
      .set({ title, updated_at: updatedAt })
      .where('id', '=', id)
      .execute()
  }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('subscription_group').where('id', '=', id).execute()
  }

  /** 现有最大 sort_key；空表返回 0。 */
  async maxSortKey(): Promise<number> {
    const row = await this.db
      .selectFrom('subscription_group')
      .select(eb => eb.fn.max<number>('sort_key').as('max_sort'))
      .executeTakeFirst()
    return row?.max_sort ?? 0
  }
}

export interface SubscriptionPatch {
  readonly groupId?: string
  readonly sortKey?: number
  readonly updatedAt: string
}

export class SubscriptionRepository {
  constructor(private readonly db: Kysely<CoreDatabase>) {}

  async insert(subscription: SubscriptionEntity): Promise<void> {
    await this.db
      .insertInto('subscription')
      .values({
        id: subscription.id,
        target_kind: subscription.targetKind,
        target_id: subscription.targetId,
        group_id: subscription.groupId,
        sort_key: subscription.sortKey,
        created_at: subscription.createdAt,
        updated_at: subscription.updatedAt,
      })
      .execute()
  }

  async get(id: string): Promise<SubscriptionEntity | undefined> {
    const row = await this.db
      .selectFrom('subscription')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row === undefined ? undefined : toSubscription(row)
  }

  async findByTarget(
    targetKind: string,
    targetId: string,
  ): Promise<SubscriptionEntity | undefined> {
    const row = await this.db
      .selectFrom('subscription')
      .selectAll()
      .where(eb => eb.and([eb('target_kind', '=', targetKind), eb('target_id', '=', targetId)]))
      .executeTakeFirst()
    return row === undefined ? undefined : toSubscription(row)
  }

  /** 指定分组内订阅，按 sort_key 升序、id 升序稳定排列。 */
  async listByGroup(groupId: string): Promise<readonly SubscriptionEntity[]> {
    const rows = await this.db
      .selectFrom('subscription')
      .selectAll()
      .where('group_id', '=', groupId)
      .orderBy('sort_key', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map(toSubscription)
  }

  async listAll(): Promise<readonly SubscriptionEntity[]> {
    const rows = await this.db
      .selectFrom('subscription')
      .selectAll()
      .orderBy('group_id', 'asc')
      .orderBy('sort_key', 'asc')
      .orderBy('id', 'asc')
      .execute()
    return rows.map(toSubscription)
  }

  async update(id: string, patch: SubscriptionPatch): Promise<void> {
    await this.db
      .updateTable('subscription')
      .set({ group_id: patch.groupId, sort_key: patch.sortKey, updated_at: patch.updatedAt })
      .where('id', '=', id)
      .execute()
  }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('subscription').where('id', '=', id).execute()
  }

  /** 指定分组内最大 sort_key；空组返回 0。 */
  async maxSortKeyInGroup(groupId: string): Promise<number> {
    const row = await this.db
      .selectFrom('subscription')
      .select(eb => eb.fn.max<number>('sort_key').as('max_sort'))
      .where('group_id', '=', groupId)
      .executeTakeFirst()
    return row?.max_sort ?? 0
  }
}