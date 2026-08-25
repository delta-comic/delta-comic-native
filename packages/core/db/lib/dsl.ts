/**
 * TypeBox 表 DSL：数据库 schema 的唯一源。
 *
 * 列经显式 builder 声明 SQLite 亲和类型与可空性，
 * 行类型由 Static + notNull 字面量推导；snapshot/diff/DDL emit 见同目录。
 */
import { Type, type Static, type TSchema } from 'typebox'

export type SqlAffinity = 'TEXT' | 'INTEGER' | 'REAL'

export interface ColumnCore<NotNull extends boolean = boolean> {
  readonly affinity: SqlAffinity
  readonly notNull: NotNull
  readonly unique?: boolean
  readonly default?: string | number | boolean | null
}

/** 存储视图：snapshot/diff/emit 消费的列元数据。 */
export type ColumnDef = ColumnCore & { readonly schema: TSchema }

export interface ColumnBuilder<T extends TSchema = TSchema, NotNull extends boolean = boolean> {
  readonly def: ColumnCore<NotNull> & { readonly schema: T }
  notNull(): ColumnBuilder<T, true>
  unique(): ColumnBuilder<T, NotNull>
  default(value: string | number | boolean | null): ColumnBuilder<T, true>
}

function make<T extends TSchema, N extends boolean>(
  schema: T,
  core: ColumnCore<N>,
): ColumnBuilder<T, N> {
  return {
    def: { ...core, schema },
    notNull: () => make(schema, { ...core, notNull: true }),
    unique: () => make(schema, { ...core, unique: true }),
    default: value => make(schema, { ...core, notNull: true, default: value }),
  }
}

function column<T extends TSchema>(affinity: SqlAffinity, schema: T): ColumnBuilder<T, false> {
  return make(schema, { affinity, notNull: false })
}

export function text(): ColumnBuilder<ReturnType<typeof Type.String>> {
  return column('TEXT', Type.String())
}

export function textNotNull(): ColumnBuilder<ReturnType<typeof Type.String>, true> {
  return text().notNull()
}

export function integer(): ColumnBuilder<ReturnType<typeof Type.Integer>> {
  return column('INTEGER', Type.Integer())
}

export function integerNotNull(): ColumnBuilder<ReturnType<typeof Type.Integer>, true> {
  return integer().notNull()
}

export function real(): ColumnBuilder<ReturnType<typeof Type.Number>> {
  return column('REAL', Type.Number())
}

/** TEXT 存十进制字符串（如雪花 ID、bigint），规避 JS 64 位精度问题。 */
export function bigTextNotNull(): ColumnBuilder<ReturnType<typeof Type.BigInt>, true> {
  return column('TEXT', Type.BigInt()).notNull()
}

/** 布尔以 INTEGER 0/1 存储。 */
export function bool(): ColumnBuilder<ReturnType<typeof Type.Boolean>> {
  return column('INTEGER', Type.Boolean())
}

export interface IndexDef {
  /** 缺省时按 idx_<table>_<列名...> 确定性命名。 */
  readonly name?: string
  readonly columns: readonly string[]
  readonly unique?: boolean
}

/** 运行时视图：snapshot/diff 等消费方使用，避免泛型不变性阻碍宽化。 */
export interface AnyTableDef {
  readonly kind: 'table'
  readonly name: string
  readonly columns: Readonly<Record<string, ColumnBuilder>>
  readonly primaryKey: readonly string[]
  readonly indexes: readonly IndexDef[]
}

export interface TableDef<
  Name extends string = string,
  Columns extends Record<string, ColumnBuilder> = Record<string, ColumnBuilder>,
> extends AnyTableDef {
  readonly name: Name
  readonly columns: Columns
  readonly primaryKey: readonly (keyof Columns & string)[]
}

export function defineTable<
  const Name extends string,
  Columns extends Record<string, ColumnBuilder<TSchema, boolean>>,
>(
  name: Name,
  def: {
    columns: Columns
    primaryKey: readonly (keyof Columns & string)[]
    indexes?: readonly IndexDef[]
  },
): TableDef<Name, Columns> {
  return {
    kind: 'table',
    name,
    columns: def.columns,
    primaryKey: def.primaryKey,
    indexes: def.indexes ?? [],
  }
}

type RowValue<B extends ColumnBuilder<TSchema, boolean>> = B['def']['notNull'] extends true
  ? Static<B['def']['schema']>
  : Static<B['def']['schema']> | null

/** 由表 DSL 推导行类型；NOT NULL 列非空，其余含 null。 */
export type TableRow<C extends Record<string, ColumnBuilder>> = {
  [K in keyof C]: RowValue<C[K]>
}

/** 由表定义集合推导 Kysely Database 形状（AnyTableDef 约束规避不变性）。 */
export type DatabaseOf<T extends readonly AnyTableDef[]> = {
  [D in T[number] as D['name']]: TableRow<D['columns']>
}