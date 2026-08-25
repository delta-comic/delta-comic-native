/**
 * PluginLoaderService：启动管线（唯一启动锚点）。
 *
 * core migration → 发现（official 先 user）→ manifest 校验 → 依赖拓扑
 * → SQL migrations + ledger → Cordis activation；
 * 失败态持久化 plugin_state，重启跳过 disabled，retry/uninstall 支持恢复。
 */
import {
  applyMigrations,
  coreMigrations,
  readLedger,
  rollbackMigrations,
  topoSortIds,
  type AppliedMigration,
  type CoreDatabase,
  type MigrationEntry,
  type MigrationLedgerDatabase,
} from '@delta-comic/db'
import { validateManifest } from '@delta-comic/protocol'
import { Service, type Context, type Fiber } from 'cordis'
import type { Kysely } from 'kysely'

import type { DiscoveredPlugin, PluginSource } from './source'
import {
  isPersistedState,
  PLUGIN_STAGES,
  type PluginFailure,
  type PluginRecord,
  type PluginRuntimeState,
  type PluginStage,
} from './state'

export interface LoaderDatabase extends MigrationLedgerDatabase, CoreDatabase {}

export interface PluginLoaderStartOptions {
  sources: readonly PluginSource[]
  db: Kysely<LoaderDatabase>
}

export interface LoaderRolledBackEvent {
  readonly id: string
  readonly reason: string
  readonly undone: readonly AppliedMigration[]
}

interface PluginSlot {
  source?: PluginSource
  discovered?: DiscoveredPlugin
  fiber?: Fiber
  migrated: boolean
  id: string
  version: string
  state: PluginRuntimeState
  failure?: PluginFailure
  dependencies: readonly string[]
}

export class PluginLoaderService extends Service {
  private readonly slots = new Map<string, PluginSlot>()
  private db?: Kysely<LoaderDatabase>

  constructor(ctx: Context) {
    super(ctx, 'pluginLoader')
  }

  /** 当前全量插件记录（恢复界面数据源）。 */
  diagnostics(): readonly PluginRecord[] {
    return [...this.slots.values()].map(slot => this.toRecord(slot))
  }

  getRecord(id: string): PluginRecord | undefined {
    const slot = this.slots.get(id)
    return slot === undefined ? undefined : this.toRecord(slot)
  }

  /** 插件 manifest 原文（未发现入口时 undefined）。 */
  manifestOf(id: string): unknown {
    return this.slots.get(id)?.discovered?.manifest
  }

  /** 重载插件：停旧 fiber 后重走激活；失败进入 disabled 并落盘。 */
  async reload(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (slot === undefined) throw new Error(`插件不存在：${id}`)
    if (slot.state !== 'active') throw new Error(`仅 active 插件可重载，当前状态：${slot.state}`)
    const fiber = slot.fiber
    if (fiber !== undefined) await fiber.dispose()
    slot.fiber = undefined
    await this.activate(slot)
  }

  /** 停用插件：卸载 fiber 并持久化 disabled，重启后保持跳过。 */
  async disable(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (slot === undefined) throw new Error(`插件不存在：${id}`)
    if (slot.state !== 'active' && slot.state !== 'unavailable') {
      throw new Error(`仅 active/unavailable 插件可停用，当前状态：${slot.state}`)
    }
    const fiber = slot.fiber
    if (fiber !== undefined) await fiber.dispose()
    slot.fiber = undefined
    this.advance(slot, 'disabled')
    await this.persist(slot)
  }

  async start(options: PluginLoaderStartOptions): Promise<void> {
    this.db = options.db
    await applyMigrations(options.db, coreMigrations)
    await this.discoverAll(options.sources)
    await this.restorePersisted()
    for (const slot of this.verifiedSlots()) await this.markMissingDependencies(slot)
    const order = await this.planOrder()
    for (const slot of order) {
      if (slot.state === 'verified') await this.runMigrations(slot, options.db)
    }
    for (const slot of order) {
      if (slot.state === 'migrated') await this.activate(slot)
    }
  }

  /** 更新插件：校验 → 增量迁移 → 换装 fiber；失败回滚本次迁移并重启旧版。 */
  async update(id: string, candidate: DiscoveredPlugin): Promise<void> {
    const db = this.requireDb()
    const slot = this.slots.get(id)
    if (slot === undefined) throw new Error(`插件不存在：${id}`)
    const result = validateManifest(candidate.manifest)
    if (!result.ok) {
      throw new Error(result.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '))
    }
    const before = new Set((await readLedger(db)).map(row => `${row.pluginId}/${row.n}`))
    const fresh = freshMigrations(candidate.migrations, before)
    try {
      await applyMigrations(db, candidate.migrations)
    } catch (error) {
      await this.rollbackOrPark(slot, db, candidate, fresh, error)
      throw error
    }
    await this.swapFiber(slot, db, candidate, fresh)
  }

  /** 重走单个插件的迁移与激活；成功后自动重走因它而 unavailable 的依赖方。 */
  async retry(id: string): Promise<void> {
    const db = this.requireDb()
    const slot = this.slots.get(id)
    if (slot === undefined) throw new Error(`插件不存在：${id}`)
    if (slot.discovered === undefined) throw new Error(`插件缺少可加载入口：${id}`)
    if (slot.state !== 'disabled' && slot.state !== 'unavailable') return
    let progressed = await this.bringUp(slot, db)
    while (progressed) {
      progressed = false
      for (const other of Array.from(this.slots.values())) {
        if (other.state === 'unavailable' && this.migrationsSatisfied(other)) {
          progressed = (await this.bringUp(other, db)) || progressed
        }
      }
    }
  }

  /** 卸载插件：停用 fiber、清理来源存储与记录，依赖方转入 unavailable。 */
  async uninstall(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (slot === undefined) throw new Error(`插件不存在：${id}`)
    try {
      const fiber = slot.fiber
      if (fiber !== undefined) await fiber.dispose()
      await slot.source?.uninstall?.(id)
    } finally {
      if (this.db !== undefined) {
        await this.db.deleteFrom('plugin_state').where('plugin_id', '=', id).execute()
      }
      this.slots.delete(id)
      for (const other of this.slots.values()) {
        if (!other.dependencies.includes(id)) continue
        this.setFailure(other, 'unavailable', 'verify', `缺少依赖：${id}`)
        await this.persist(other)
      }
    }
  }

  private toRecord(slot: PluginSlot): PluginRecord {
    return {
      id: slot.id,
      version: slot.version,
      state: slot.state,
      ...(slot.failure === undefined ? {} : { failure: slot.failure }),
      dependencies: slot.dependencies,
    }
  }

  private requireDb(): Kysely<LoaderDatabase> {
    if (this.db === undefined) throw new Error('loader 尚未 start')
    return this.db
  }

  private verifiedSlots(): PluginSlot[] {
    return [...this.slots.values()].filter(slot => slot.state === 'verified')
  }

  private dependenciesOf(slot: PluginSlot): readonly string[] {
    return slot.discovered?.manifest.dependencies ?? []
  }

  private migrationsSatisfied(slot: PluginSlot): boolean {
    return this.dependenciesOf(slot).every(dep => {
      const state = this.slots.get(dep)?.state
      return state === 'migrated' || state === 'active'
    })
  }

  private blockedDependency(
    slot: PluginSlot,
    satisfied: (dep: string) => boolean,
  ): string | undefined {
    for (const dep of this.dependenciesOf(slot)) {
      if (!satisfied(dep)) return dep
    }
    return undefined
  }

  private setFailure(
    slot: PluginSlot,
    state: Extract<PluginRuntimeState, 'disabled' | 'unavailable'>,
    stage: PluginStage,
    message: string,
  ): void {
    slot.state = state
    slot.failure = { stage, message }
    this.ctx.emit('loader/plugin-state', this.toRecord(slot))
  }

  private advance(slot: PluginSlot, state: PluginRuntimeState): void {
    slot.state = state
    slot.failure = undefined
    this.ctx.emit('loader/plugin-state', this.toRecord(slot))
  }

  private async persist(slot: PluginSlot): Promise<void> {
    const db = this.requireDb()
    if (!isPersistedState(slot.state)) {
      await db.deleteFrom('plugin_state').where('plugin_id', '=', slot.id).execute()
      return
    }
    const error = slot.failure === undefined ? null : JSON.stringify(slot.failure)
    const updated_at = new Date().toISOString()
    await db
      .insertInto('plugin_state')
      .values({ plugin_id: slot.id, state: slot.state, version: slot.version, error, updated_at })
      .onConflict(oc =>
        oc.column('plugin_id').doUpdateSet({ state: slot.state, error, updated_at }),
      )
      .execute()
  }

  private async discoverAll(sources: readonly PluginSource[]): Promise<void> {
    for (const source of sources) {
      let found: readonly DiscoveredPlugin[]
      try {
        found = await source.discover()
      } catch (error) {
        this.ctx.logger.error('插件来源 %s 发现失败：%s', source.stage, errorMessage(error))
        continue
      }
      for (const discovered of found) {
        const manifest = discovered.manifest
        if (typeof manifest?.id !== 'string' || manifest.id.length === 0) {
          this.ctx.logger.error('插件来源 %s 存在缺少 id 的 manifest，已忽略', source.stage)
          continue
        }
        if (this.slots.has(manifest.id)) {
          this.ctx.logger.error(
            '插件 id 重复：%s（来源 %s），后者被忽略',
            manifest.id,
            source.stage,
          )
          continue
        }
        const slot: PluginSlot = {
          id: manifest.id,
          version: typeof manifest.version === 'string' ? manifest.version : '',
          state: 'discovered',
          migrated: false,
          dependencies: Array.isArray(manifest.dependencies) ? [...manifest.dependencies] : [],
          source,
          discovered,
        }
        this.slots.set(slot.id, slot)
        this.ctx.emit('loader/plugin-state', this.toRecord(slot))
        const result = validateManifest(manifest)
        if (!result.ok) {
          this.setFailure(
            slot,
            'disabled',
            'verify',
            result.issues.map(issue => `${issue.path}: ${issue.message}`).join('; '),
          )
          await this.persist(slot)
          continue
        }
        this.advance(slot, 'verified')
      }
    }
  }

  /** 恢复持久化 disabled：重启后直接跳过管线；unavailable 每次启动重新评估。 */
  private async restorePersisted(): Promise<void> {
    const rows = await this.requireDb().selectFrom('plugin_state').selectAll().execute()
    for (const row of rows) {
      const slot = this.slots.get(row.plugin_id)
      if (slot === undefined || row.state !== 'disabled') continue
      slot.state = 'disabled'
      slot.failure = parseFailure(row.error)
      this.ctx.emit('loader/plugin-state', this.toRecord(slot))
    }
  }

  private async markMissingDependencies(slot: PluginSlot): Promise<void> {
    for (const dep of this.dependenciesOf(slot)) {
      const target = this.slots.get(dep)
      if (target === undefined || target.state !== 'verified') {
        this.setFailure(slot, 'unavailable', 'verify', `缺少依赖：${dep}`)
        await this.persist(slot)
        return
      }
    }
  }

  /** 拓扑排序剩余 verified 插件；成环时全体标记 disabled。 */
  private async planOrder(): Promise<PluginSlot[]> {
    const pending = this.verifiedSlots()
    const deps = Object.fromEntries(pending.map(slot => [slot.id, this.dependenciesOf(slot)]))
    try {
      const order = topoSortIds(
        pending.map(slot => slot.id),
        deps,
      )
      const byId = new Map(pending.map(slot => [slot.id, slot]))
      return order.flatMap(id => {
        const slot = byId.get(id)
        return slot === undefined ? [] : [slot]
      })
    } catch (error) {
      const message = errorMessage(error)
      for (const slot of pending) {
        this.setFailure(slot, 'disabled', 'verify', message)
        await this.persist(slot)
      }
      return []
    }
  }

  /** 单插件完整推进：migrate → activate；成功 true。 */
  private async bringUp(slot: PluginSlot, db: Kysely<LoaderDatabase>): Promise<boolean> {
    if (await this.runMigrations(slot, db)) return this.activate(slot)
    return false
  }

  private async runMigrations(slot: PluginSlot, db: Kysely<LoaderDatabase>): Promise<boolean> {
    if (slot.discovered === undefined || slot.state === 'active') return false
    if (slot.migrated) return true
    const blocker = this.blockedDependency(slot, dep =>
      ['migrated', 'active'].includes(this.slots.get(dep)?.state ?? ''),
    )
    if (blocker !== undefined) {
      this.setFailure(slot, 'unavailable', 'verify', `依赖不可用：${blocker}`)
      await this.persist(slot)
      return false
    }
    this.advance(slot, 'migrating')
    try {
      await applyMigrations(db, slot.discovered.migrations)
    } catch (error) {
      this.setFailure(slot, 'disabled', 'migrate', errorMessage(error))
      await this.persist(slot)
      return false
    }
    slot.migrated = true
    this.advance(slot, 'migrated')
    return true
  }

  private async activate(slot: PluginSlot): Promise<boolean> {
    const discovered = slot.discovered
    if (discovered === undefined) return false
    const blocker = this.blockedDependency(slot, dep => this.slots.get(dep)?.state === 'active')
    if (blocker !== undefined) {
      this.setFailure(slot, 'unavailable', 'activate', `依赖不可用：${blocker}`)
      await this.persist(slot)
      return false
    }
    this.advance(slot, 'activating')
    try {
      const entry = await discovered.resolveEntry()
      slot.fiber = await this.ctx.plugin(entry)
    } catch (error) {
      this.setFailure(slot, 'disabled', 'activate', errorMessage(error))
      await this.persist(slot)
      return false
    }
    this.advance(slot, 'active')
    await this.persist(slot)
    return true
  }

  /** 回滚本次更新迁移；回滚也失败则进入人工恢复态（disabled/rollback 持久化）。 */
  private async rollbackOrPark(
    slot: PluginSlot,
    db: Kysely<LoaderDatabase>,
    candidate: DiscoveredPlugin,
    fresh: readonly MigrationEntry[],
    cause: unknown,
  ): Promise<boolean> {
    const reason = errorMessage(cause)
    let undone: readonly AppliedMigration[] = []
    try {
      undone = await rollbackMigrations(db, fresh)
    } catch (rollbackError) {
      const fiber = slot.fiber
      if (fiber !== undefined) await fiber.dispose()
      slot.fiber = undefined
      this.adoptCandidate(slot, candidate)
      this.setFailure(
        slot,
        'disabled',
        'rollback',
        `${reason}；回滚失败：${errorMessage(rollbackError)}`,
      )
      await this.persist(slot)
      return false
    }
    this.ctx.emit('loader/rolled-back', { id: slot.id, reason, undone })
    return true
  }

  /** 槽位切换为候选版本（人工恢复态下已安装包即新版本）。 */
  private adoptCandidate(slot: PluginSlot, candidate: DiscoveredPlugin): void {
    slot.discovered = candidate
    slot.version =
      typeof candidate.manifest.version === 'string' ? candidate.manifest.version : slot.version
    slot.dependencies = Array.isArray(candidate.manifest.dependencies)
      ? [...candidate.manifest.dependencies]
      : []
  }

  /** 换装 fiber：停旧 → 启新；激活失败回滚后重启旧版。 */
  private async swapFiber(
    slot: PluginSlot,
    db: Kysely<LoaderDatabase>,
    candidate: DiscoveredPlugin,
    fresh: readonly MigrationEntry[],
  ): Promise<void> {
    const previousDiscovered = slot.discovered
    if (slot.fiber !== undefined) await slot.fiber.dispose()
    slot.fiber = undefined
    this.advance(slot, 'activating')
    try {
      const entry = await candidate.resolveEntry()
      slot.fiber = await this.ctx.plugin(entry)
    } catch (error) {
      const rolledBack = await this.rollbackOrPark(slot, db, candidate, fresh, error)
      if (!rolledBack) return
      if (previousDiscovered === undefined) {
        this.setFailure(slot, 'disabled', 'activate', errorMessage(error))
        await this.persist(slot)
        return
      }
      try {
        const oldEntry = await previousDiscovered.resolveEntry()
        slot.fiber = await this.ctx.plugin(oldEntry)
      } catch (restartError) {
        this.setFailure(slot, 'disabled', 'activate', `旧版重启失败：${errorMessage(restartError)}`)
        await this.persist(slot)
        return
      }
      this.advance(slot, 'active')
      await this.persist(slot)
      return
    }
    this.adoptCandidate(slot, candidate)
    slot.migrated = true
    this.advance(slot, 'active')
    await this.persist(slot)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 本次更新新落账的迁移（此前已在 ledger 的历史迁移保持不动）。 */
function freshMigrations(
  migrations: readonly MigrationEntry[],
  before: ReadonlySet<string>,
): MigrationEntry[] {
  return migrations.filter(entry => !before.has(`${entry.pluginId}/${entry.n}`))
}

function parseFailure(raw: string | null): PluginFailure | undefined {
  const fallback: PluginFailure = { stage: 'activate', message: raw ?? '' }
  if (raw === null) return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (typeof value !== 'object' || value === null) return fallback
  const record = value as { stage?: unknown; message?: unknown }
  if (typeof record.message !== 'string') return fallback
  const stage = PLUGIN_STAGES.find(candidate => candidate === record.stage)
  if (stage === undefined) return fallback
  return { stage, message: record.message }
}

declare module 'cordis' {
  interface Events {
    /** 插件状态机每次跃迁广播。 @mode emit */
    'loader/plugin-state'(record: PluginRecord): void
    /** 更新激活失败回滚完成。 @mode emit */
    'loader/rolled-back'(event: LoaderRolledBackEvent): void
  }
  interface Context {
    pluginLoader: PluginLoaderService
  }
}