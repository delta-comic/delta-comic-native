/**
 * normalized snapshot：表 DSL 的 JSON 可序列化投影，diff 的输入形态。
 */
import type { AnyTableDef } from './dsl'

export interface SnapshotColumn {
  readonly affinity: string
  readonly notNull: boolean
  readonly unique?: boolean
  readonly default?: string | number | boolean | null
}

export interface SnapshotIndex {
  readonly name: string
  readonly columns: readonly string[]
  readonly unique: boolean
}

export interface SnapshotTable {
  readonly columns: Readonly<Record<string, SnapshotColumn>>
  readonly primaryKey: readonly string[]
  readonly indexes: readonly SnapshotIndex[]
}

export interface Snapshot {
  readonly version: 1
  readonly tables: Readonly<Record<string, SnapshotTable>>
}

export function snapshotOf(tables: readonly AnyTableDef[]): Snapshot {
  const out: Record<string, SnapshotTable> = {}
  for (const table of tables) {
    const columns: Record<string, SnapshotColumn> = {}
    for (const [name, column] of Object.entries(table.columns)) {
      columns[name] = {
        affinity: column.def.affinity,
        notNull: column.def.notNull,
        ...(column.def.unique === true ? { unique: true } : {}),
        ...(column.def.default !== undefined ? { default: column.def.default } : {}),
      }
    }
    out[table.name] = {
      columns,
      primaryKey: [...table.primaryKey],
      indexes: table.indexes.map(index => ({
        name: index.name ?? indexName(table.name, index.columns),
        columns: [...index.columns],
        unique: index.unique === true,
      })),
    }
  }
  return { version: 1, tables: out }
}

export function indexName(table: string, columns: readonly string[]): string {
  return ['idx', table, ...columns].join('_')
}

export function tablesEqual(a: SnapshotTable, b: SnapshotTable): boolean {
  return (
    JSON.stringify(a.columns) === JSON.stringify(b.columns) &&
    JSON.stringify(a.primaryKey) === JSON.stringify(b.primaryKey) &&
    JSON.stringify([...a.indexes].sort(byName)) === JSON.stringify([...b.indexes].sort(byName))
  )
}

function byName(a: SnapshotIndex, b: SnapshotIndex): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}