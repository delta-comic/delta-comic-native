/**
 * snapshot diff -> migration plan -> up/down .sql 文本。
 *
 * SQLite 方言；复杂 ALTER 走 table rebuild 序列；
 * 无法安全表达的操作显式抛错，不静默猜测。
 */
import { diffSnapshots, type MigrationPlan } from './diff'
import { indexName, type Snapshot } from './snapshot'

export interface CompiledMigration {
  readonly plan: MigrationPlan
  readonly up: readonly string[]
  readonly down: readonly string[]
}

export function compileMigration(before: Snapshot | null, after: Snapshot): CompiledMigration {
  const plan = diffSnapshots(before, after)
  return {
    plan,
    up: emitForward(before, after, plan),
    down: before === null ? [] : emitForward(after, before, diffSnapshots(after, before)),
  }
}

function emitForward(from: Snapshot | null, to: Snapshot, plan: MigrationPlan): string[] {
  const out: string[] = []
  for (const item of plan.items) {
    switch (item.op) {
      case 'createTable':
        out.push(createTableSql(item.table, to))
        break
      case 'dropTable':
        out.push(`DROP TABLE ${q(item.table)}`)
        break
      case 'addColumn':
        out.push(addColumnSql(item.table, item.column, to))
        break
      case 'dropColumn':
        out.push(`ALTER TABLE ${q(item.table)} DROP COLUMN ${q(item.column)}`)
        break
      case 'createIndex': {
        const index = findIndex(to.tables[item.table], item.index)
        out.push(createIndexSql(item.table, index.name, index.columns, index.unique))
        break
      }
      case 'dropIndex':
        out.push(`DROP INDEX IF EXISTS ${q(item.index)}`)
        break
      case 'rebuildTable':
        out.push(...rebuildSql(item.table, from, to))
        break
    }
  }
  return out
}

function createTableSql(name: string, snapshot: Snapshot): string {
  const table = snapshot.tables[name]
  if (table === undefined) throw new Error(`snapshot 缺少表定义：${name}`)
  const lines = Object.entries(table.columns).map(([column, def]) => columnSql(column, def))
  lines.push(`PRIMARY KEY (${table.primaryKey.map(q).join(', ')})`)
  const uniqueColumns = Object.entries(table.columns).filter(([, def]) => def.unique === true)
  return `CREATE TABLE ${q(name)} (\n  ${[...lines, ...uniqueColumns.map(([column]) => `UNIQUE (${q(column)})`)].join(',\n  ')}\n)`
}

function addColumnSql(table: string, column: string, snapshot: Snapshot): string {
  const def = snapshot.tables[table]?.columns[column]
  if (def === undefined) throw new Error(`snapshot 缺少列定义：${table}.${column}`)
  // SQLite ADD COLUMN 不支持 NOT NULL 无默认值与 UNIQUE 约束，显式拒绝。
  if (def.notNull && !('default' in def)) {
    throw new Error(`${table}.${column}：ADD COLUMN 声明 NOT NULL 必须显式提供 default`)
  }
  if (def.unique === true) {
    throw new Error(`${table}.${column}：ADD COLUMN 不支持 UNIQUE，请改为显式索引`)
  }
  return `ALTER TABLE ${q(table)} ADD COLUMN ${columnSql(column, def)}`
}

function rebuildSql(table: string, from: Snapshot | null, to: Snapshot): string[] {
  const next = to.tables[table]
  const prev = from?.tables[table]
  if (next === undefined || prev === undefined) throw new Error(`rebuild 缺少前后快照：${table}`)
  const temp = `${table}__rebuild`
  const statements = [
    createTableSql(temp, renameTableSnapshot(to, table, temp)),
    `INSERT INTO ${q(temp)} (${Object.keys(next.columns).map(q).join(', ')}) SELECT ${Object.keys(
      next.columns,
    )
      .filter(column => prev.columns[column] !== undefined)
      .map(q)
      .join(', ')} FROM ${q(table)}`,
    `DROP TABLE ${q(table)}`,
    `ALTER TABLE ${q(temp)} RENAME TO ${q(table)}`,
    ...next.indexes.map(index => createIndexSql(table, index.name, index.columns, index.unique)),
  ]
  return statements
}

function createIndexSql(
  table: string,
  name: string,
  columns: readonly string[],
  unique: boolean,
): string {
  return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${q(name)} ON ${q(table)} (${columns.map(q).join(', ')})`
}

function columnSql(
  name: string,
  def: { affinity: string; notNull: boolean; default?: unknown },
): string {
  const parts = [q(name), def.affinity]
  if (def.notNull && 'default' in def) parts.push('NOT NULL', `DEFAULT ${literal(def.default)}`)
  else if (def.notNull) parts.push('NOT NULL')
  else if ('default' in def) parts.push(`DEFAULT ${literal(def.default)}`)
  return parts.join(' ')
}

function literal(value: unknown): string {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

function renameTableSnapshot(snapshot: Snapshot, from: string, to: string): Snapshot {
  const tables = { ...snapshot.tables }
  delete tables[from]
  tables[to] = snapshot.tables[from]
  return { version: 1, tables }
}

function findIndex(table: Snapshot['tables'][string], name: string) {
  const index = table?.indexes.find(candidate => candidate.name === name)
  if (index === undefined) throw new Error(`snapshot 缺少索引定义：${name}`)
  return index
}

export { indexName }

function q(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}