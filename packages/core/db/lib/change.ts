/**
 * change batch -> change bus -> typed observation。
 *
 * 表集合经 module augmentation 声明到 DatabaseTables；
 * change_log 的职责仅为 typed observation 与保留策略裁剪。
 */

/** 表集合挂点：key 为表名，值为行类型。 */
export interface DatabaseTables {}

export type ChangeKind = 'insert' | 'update' | 'delete'

export interface TableChange<K extends keyof DatabaseTables = keyof DatabaseTables> {
  readonly table: K
  readonly kind: ChangeKind
  /** 主键值（雪花 ID 为 TEXT 十进制）。 */
  readonly id: string
}

export type ChangeBatch = ReadonlyArray<TableChange>

type ChangeListener = (batch: ChangeBatch) => void

export type Unsubscribe = () => void

export class ChangeBus {
  readonly #listeners = new Set<ChangeListener>()

  subscribe(listener: ChangeListener): Unsubscribe {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** 表过滤的 typed observation 入口。 */
  observe<K extends keyof DatabaseTables>(
    table: K,
    listener: (changes: ReadonlyArray<TableChange<K>>) => void,
  ): Unsubscribe {
    return this.subscribe(batch => {
      const matched = batch.filter((change): change is TableChange<K> => change.table === table)
      if (matched.length > 0) listener(matched)
    })
  }

  publish(batch: ChangeBatch): void {
    if (batch.length === 0) return
    for (const listener of this.#listeners) listener(batch)
  }
}