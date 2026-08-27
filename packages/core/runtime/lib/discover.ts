/**
 * 工件 → loader 契约桥接：把 plugin.zip 变为 DiscoveredPlugin，
 * 供宿主以 PluginSource 形态接入 PluginLoaderService。
 *
 * resolveEntry 时机（loader activate 阶段）才做入口选择 + sha256 校验 + 求值；
 * 发现阶段的失败仅来自 zip/manifest 结构损坏。
 */
import type { MigrationEntry } from '@delta-comic/db'
import type { DiscoveredPlugin } from '@delta-comic/loader'
import { validateManifest, type PluginManifest } from '@delta-comic/protocol'
import type { Plugin } from 'cordis'

import {
  ArtifactError,
  hashOf,
  openPluginArtifact,
  selectEntry,
  verifyEntries,
  type TargetPlatform,
} from './artifact.ts'
import type { ModuleEvaluator } from './evaluator.ts'

export interface DiscoveryOptions {
  readonly platform: TargetPlatform
  readonly evaluator: ModuleEvaluator
}

const MIGRATION_UP = /^(\d{4,})-([a-z0-9][a-z0-9-]*)\.up\.sql$/

/** 从 plugin.zip 字节发现插件；zip/manifest 结构问题当场抛 ArtifactError。 */
export function discoverFromArtifact(zip: Uint8Array, options: DiscoveryOptions): DiscoveredPlugin {
  const artifact = openPluginArtifact(zip)
  const result = validateManifest(artifact.manifest)
  if (!result.ok) {
    const detail = result.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ')
    throw new ArtifactError('manifest', `manifest 校验失败：${detail}`)
  }
  const manifest: PluginManifest = result.manifest
  const integrity = verifyEntries(manifest, artifact.files)
  if (integrity.length > 0) {
    const first = integrity[0]
    throw new ArtifactError(
      'entry-missing',
      `入口校验失败 ${first.key}(${first.path})：期望 ${first.expected}，实际 ${first.actual}`,
    )
  }
  return {
    manifest,
    migrations: parseMigrations(manifest.id, artifact.files),
    resolveEntry: () => resolveEntry(manifest, artifact.files, options),
  }
}

async function resolveEntry(
  manifest: PluginManifest,
  files: ReadonlyMap<string, Uint8Array>,
  options: DiscoveryOptions,
): Promise<Plugin> {
  const entry = selectEntry(manifest, options.platform)
  const bytes = files.get(entry.path)
  if (bytes === undefined) {
    throw new ArtifactError('entry-missing', `入口文件缺失：${entry.path}`)
  }
  if (hashOf(bytes) !== entry.sha256) {
    throw new ArtifactError('entry-missing', `入口内容与 sha256 不符：${entry.path}`)
  }
  const module = await options.evaluator({ path: entry.path, bytes })
  // 与 cordis loader 对齐：先取 default，无则回退 namespace（named exports with apply）。
  const candidate = module.default ?? module
  if (typeof candidate === 'function') return candidate as Plugin
  if (typeof candidate === 'object' && candidate !== null) {
    if (typeof (candidate as Record<string, unknown>).apply === 'function') {
      return candidate as Plugin
    }
  }
  throw new ArtifactError(
    'entry-missing',
    `入口缺少 default 导出或 apply（Cordis plugin）：${entry.path}`,
  )
}

/** 解析 migrations/*.sql 文件对：<n>-<name>.up.sql 必须有同名 .down.sql；按 n 升序。 */
function parseMigrations(pluginId: string, files: ReadonlyMap<string, Uint8Array>) {
  const found: MigrationEntry[] = []
  for (const path of files.keys()) {
    const match = MIGRATION_UP.exec(path.replace('migrations/', ''))
    if (match === null || !path.startsWith('migrations/')) continue
    const [, digits, name] = match
    const downPath = `migrations/${digits}-${name}.down.sql`
    const up = files.get(path)
    const down = files.get(downPath)
    if (up === undefined || down === undefined) {
      throw new ArtifactError('manifest', `迁移缺少 down 文件：${downPath}`)
    }
    found.push({ pluginId, n: Number(digits), name, up: decode(up), down: decode(down) })
  }
  return found.sort((a, b) => a.n - b.n)
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}