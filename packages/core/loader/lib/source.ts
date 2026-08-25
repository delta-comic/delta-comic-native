/**
 * 插件发现契约：宿主以 PluginSource 注入 official/user 两级来源，
 * loader 只面向该接口工作（official 先于 user 发现）。
 */
import type { MigrationEntry } from '@delta-comic/db'
import type { PluginManifest } from '@delta-comic/protocol'
import type { Plugin } from 'cordis'

export interface DiscoveredPlugin {
  /** 原始 manifest，由 loader 统一校验。 */
  readonly manifest: PluginManifest
  /** 加载插件入口模块（Cordis plugin 形态）。 */
  resolveEntry(): Promise<Plugin>
  /** 包内 SQL migrations，(pluginId, n) 由 loader 校验唯一。 */
  readonly migrations: readonly MigrationEntry[]
}

export interface PluginSource {
  readonly stage: 'official' | 'user'
  discover(): Promise<readonly DiscoveredPlugin[]>
  uninstall?(id: string): Promise<void>
}