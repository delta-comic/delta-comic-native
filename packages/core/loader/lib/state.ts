/**
 * 插件状态机与失败详情。
 *
 * discovered→verified→migrating→migrated→activating→active；
 * 任一阶段失败进入 disabled（恢复界面可 retry/uninstall），
 * 依赖无法满足时进入 unavailable（依赖恢复后自动重走）。
 */

export type PluginStage = 'verify' | 'migrate' | 'activate' | 'rollback'

export const PLUGIN_STAGES: readonly PluginStage[] = ['verify', 'migrate', 'activate', 'rollback']

export type PluginRuntimeState =
  | 'discovered'
  | 'verified'
  | 'migrating'
  | 'migrated'
  | 'activating'
  | 'active'
  | 'disabled'
  | 'unavailable'

export interface PluginFailure {
  readonly stage: PluginStage
  readonly message: string
}

export interface PluginRecord {
  readonly id: string
  readonly version: string
  readonly state: PluginRuntimeState
  readonly failure?: PluginFailure
  readonly dependencies: readonly string[]
}

/** 持久化到 plugin_state 的失败态集合（active 时清行，其余运行态不落盘）。 */
export const PERSISTED_STATES: ReadonlySet<PluginRuntimeState> = new Set([
  'disabled',
  'unavailable',
])

export function isPersistedState(state: PluginRuntimeState): boolean {
  return PERSISTED_STATES.has(state)
}