/**
 * snapshot diff -> migration plan。
 *
 * 分类显式（additive / destructive / rebuild），不静默猜测语义；
 * 列变更与主键变更一律判为 rebuild，由 SQL emit 层生成建表-拷贝-替换序列。
 */
import { tablesEqual, type Snapshot, type SnapshotTable } from './snapshot'

export type PlanCategory = 'additive' | 'destructive' | 'rebuild'

export type PlanItem =
  | { readonly category: 'additive'; readonly op: 'createTable'; readonly table: string }
  | { readonly category: 'destructive'; readonly op: 'dropTable'; readonly table: string }
  | {
      readonly category: 'additive'
      readonly op: 'addColumn'
      readonly table: string
      readonly column: string
    }
  | {
      readonly category: 'destructive'
      readonly op: 'dropColumn'
      readonly table: string
      readonly column: string
    }
  | {
      readonly category: 'additive'
      readonly op: 'createIndex'
      readonly table: string
      readonly index: string
    }
  | {
      readonly category: 'destructive'
      readonly op: 'dropIndex'
      readonly table: string
      readonly index: string
    }
  | { readonly category: 'rebuild'; readonly op: 'rebuildTable'; readonly table: string }

export interface MigrationPlan {
  readonly items: readonly PlanItem[]
}

export function diffSnapshots(before: Snapshot | null, after: Snapshot): MigrationPlan {
  const items: PlanItem[] = []
  const beforeTables = before?.tables ?? {}

  for (const [name, next] of Object.entries(after.tables)) {
    const prev = beforeTables[name]
    if (prev === undefined) {
      items.push({ category: 'additive', op: 'createTable', table: name })
      for (const index of next.indexes) {
        items.push({ category: 'additive', op: 'createIndex', table: name, index: index.name })
      }
      continue
    }
    if (!tablesEqual(prev, next) && needsRebuild(prev, next)) {
      items.push({ category: 'rebuild', op: 'rebuildTable', table: name })
      continue
    }

    for (const column of Object.keys(next.columns)) {
      if (prev.columns[column] === undefined) {
        items.push({ category: 'additive', op: 'addColumn', table: name, column })
      }
    }
    for (const column of Object.keys(prev.columns)) {
      if (next.columns[column] === undefined) {
        items.push({ category: 'destructive', op: 'dropColumn', table: name, column })
      }
    }
    const nextIndexes = new Map(next.indexes.map(index => [index.name, index]))
    const prevIndexes = new Map(prev.indexes.map(index => [index.name, index]))
    for (const index of prev.indexes) {
      const target = nextIndexes.get(index.name)
      if (target === undefined || changed(target, index)) {
        items.push({ category: 'destructive', op: 'dropIndex', table: name, index: index.name })
      }
    }
    for (const index of next.indexes) {
      const source = prevIndexes.get(index.name)
      if (source === undefined || changed(source, index)) {
        items.push({ category: 'additive', op: 'createIndex', table: name, index: index.name })
      }
    }
  }

  for (const name of Object.keys(beforeTables)) {
    if (after.tables[name] === undefined) {
      items.push({ category: 'destructive', op: 'dropTable', table: name })
    }
  }
  return { items }
}

function needsRebuild(prev: SnapshotTable, next: SnapshotTable): boolean {
  if (JSON.stringify(prev.primaryKey) !== JSON.stringify(next.primaryKey)) return true
  for (const [name, before] of Object.entries(prev.columns)) {
    const after = next.columns[name]
    if (after === undefined) continue
    if (
      before.affinity !== after.affinity ||
      before.notNull !== after.notNull ||
      (before.unique ?? false) !== (after.unique ?? false) ||
      JSON.stringify(before.default) !== JSON.stringify(after.default)
    ) {
      return true
    }
  }
  return false
}

function changed(
  a: SnapshotTable['indexes'][number],
  b: SnapshotTable['indexes'][number],
): boolean {
  return a.unique !== b.unique || JSON.stringify(a.columns) !== JSON.stringify(b.columns)
}