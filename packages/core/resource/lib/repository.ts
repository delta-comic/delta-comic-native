/**
 * 资源域持久化仓库：裸 Kysely 操作 CoreDatabase（loader persist 同款先例）。
 *
 * - ResourceRepository：归一化 descriptor 的 upsert/find/remove 缓存
 * - DownloadTaskRepository：下载任务行级 CRUD，支撑断点续传与重启恢复
 */
import type { CoreDatabase, DownloadTaskRow, ResourceRow } from '@delta-comic/db'
import type { ResourceDescriptor } from '@delta-comic/protocol'
import type { Kysely } from 'kysely'

export class ResourceRepository {
  constructor(private readonly db: Kysely<CoreDatabase>) {}

  async upsert(descriptor: ResourceDescriptor): Promise<void> {
    const updated_at = new Date().toISOString()
    await this.db
      .insertInto('resource')
      .values({
        kind: descriptor.kind,
        ref: descriptor.ref,
        size_bytes: descriptor.size ?? null,
        checksum_algorithm: descriptor.checksum?.algorithm ?? null,
        checksum_digest: descriptor.checksum?.digest ?? null,
        mime: descriptor.mime ?? null,
        updated_at,
      })
      .onConflict(oc =>
        oc.columns(['kind', 'ref']).doUpdateSet({
          size_bytes: descriptor.size ?? null,
          checksum_algorithm: descriptor.checksum?.algorithm ?? null,
          checksum_digest: descriptor.checksum?.digest ?? null,
          mime: descriptor.mime ?? null,
          updated_at,
        }),
      )
      .execute()
  }

  async find(kind: string, ref: string): Promise<ResourceDescriptor | undefined> {
    const row = await this.db
      .selectFrom('resource')
      .selectAll()
      .where(eb => eb.and([eb('kind', '=', kind), eb('ref', '=', ref)]))
      .executeTakeFirst()
    if (row === undefined) return undefined
    return rowToDescriptor(row)
  }

  async remove(kind: string, ref: string): Promise<void> {
    await this.db
      .deleteFrom('resource')
      .where(eb => eb.and([eb('kind', '=', kind), eb('ref', '=', ref)]))
      .execute()
  }
}

function rowToDescriptor(row: ResourceRow): ResourceDescriptor {
  const checksum =
    row.checksum_algorithm === null || row.checksum_digest === null
      ? undefined
      : { algorithm: row.checksum_algorithm, digest: row.checksum_digest }
  return {
    kind: row.kind,
    ref: row.ref,
    size: row.size_bytes === null ? undefined : row.size_bytes,
    checksum,
    mime: row.mime === null ? undefined : row.mime,
  }
}

export interface StoredDownloadTask {
  readonly id: string
  readonly kind: string
  readonly ref: string
  readonly destKey: string
  readonly status: string
  readonly receivedBytes: number
  readonly totalBytes?: number
  readonly error?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export class DownloadTaskRepository {
  constructor(private readonly db: Kysely<CoreDatabase>) {}

  async insert(task: StoredDownloadTask): Promise<void> {
    await this.db.insertInto('download_task').values(taskToRow(task)).execute()
  }

  async update(
    id: string,
    patch: Partial<Pick<StoredDownloadTask, 'status' | 'receivedBytes' | 'totalBytes' | 'error'>>,
  ): Promise<void> {
    await this.db
      .updateTable('download_task')
      .set({
        status: patch.status,
        received_bytes: patch.receivedBytes,
        total_bytes: patch.totalBytes ?? null,
        error: patch.error ?? null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .execute()
  }

  async get(id: string): Promise<StoredDownloadTask | undefined> {
    const row = await this.db
      .selectFrom('download_task')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row === undefined ? undefined : rowToTask(row)
  }

  async list(): Promise<StoredDownloadTask[]> {
    const rows = await this.db.selectFrom('download_task').selectAll().execute()
    return rows.map(rowToTask)
  }

  async remove(id: string): Promise<void> {
    await this.db.deleteFrom('download_task').where('id', '=', id).execute()
  }
}

function taskToRow(task: StoredDownloadTask): DownloadTaskRow {
  return {
    id: task.id,
    kind: task.kind,
    ref: task.ref,
    dest_key: task.destKey,
    status: task.status,
    received_bytes: task.receivedBytes,
    total_bytes: task.totalBytes ?? null,
    error: task.error ?? null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  }
}

function rowToTask(row: DownloadTaskRow): StoredDownloadTask {
  return {
    id: row.id,
    kind: row.kind,
    ref: row.ref,
    destKey: row.dest_key,
    status: row.status,
    receivedBytes: row.received_bytes,
    totalBytes: row.total_bytes === null ? undefined : row.total_bytes,
    error: row.error === null ? undefined : row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
