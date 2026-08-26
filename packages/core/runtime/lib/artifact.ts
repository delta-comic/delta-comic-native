import type { PluginManifest } from '@delta-comic/protocol'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
/**
 * 插件包（plugin.zip）工件层：解压、manifest 解析、平台入口选择与完整性校验。
 *
 * zip 约定（由 @delta-comic/plugin-build 产出）：
 * - manifest.json 位于根
 * - 入口文件路径以 manifest.entries[<platform>] / entries.common 声明
 * - migrations/ 下为 <n>-<name>.up.sql 与同名 .down.sql 对
 */
import { unzipSync } from 'fflate'

export type TargetPlatform = 'web' | 'android' | 'macos' | 'windows'

export const TARGET_PLATFORMS: readonly TargetPlatform[] = ['web', 'android', 'macos', 'windows']

/** 已解开的插件包：manifest 原文 + 全部文件字节（zip 内相对路径 → 内容）。 */
export interface PluginArtifact {
  readonly manifest: unknown
  readonly files: ReadonlyMap<string, Uint8Array>
}

export type ArtifactErrorCode = 'zip' | 'manifest' | 'entry-missing'

export class ArtifactError extends Error {
  constructor(
    readonly code: ArtifactErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ArtifactError'
  }
}

/** 校验通过后的 manifest 形态（validateManifest 的 ok 分支）。 */
export type ValidManifest = PluginManifest

/** 打开 plugin.zip 字节：解压并解析 manifest.json；结构损坏抛 ArtifactError。 */
export function openPluginArtifact(zip: Uint8Array): PluginArtifact {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(zip)
  } catch (cause) {
    throw new ArtifactError('zip', `plugin.zip 解压失败：${describe(cause)}`)
  }
  const raw = entries['manifest.json']
  if (raw === undefined) {
    throw new ArtifactError('manifest', 'plugin.zip 缺少 manifest.json')
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(new TextDecoder().decode(raw))
  } catch (cause) {
    throw new ArtifactError('manifest', `manifest.json 不是合法 JSON：${describe(cause)}`)
  }
  const files = new Map<string, Uint8Array>()
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    files.set(path, bytes)
  }
  return { manifest, files }
}

/**
 * 平台入口选择：优先平台覆盖，回落 common。
 * 仅做声明读取；文件存在性在 resolveEntry 时校验。
 */
export function selectEntry(manifest: ValidManifest, platform: TargetPlatform) {
  return manifest.entries[platform] ?? manifest.entries.common
}

export interface EntryIntegrityIssue {
  readonly key: string
  readonly path: string
  readonly expected: string
  readonly actual: string
}

/** 对照 manifest 声明逐一核对入口文件 sha256；返回全部不匹配项。 */
export function verifyEntries(
  manifest: ValidManifest,
  files: ReadonlyMap<string, Uint8Array>,
): readonly EntryIntegrityIssue[] {
  const declared = [
    ...Object.entries(manifest.entries),
    ...(manifest.fallback === undefined ? [] : [['fallback', manifest.fallback] as const]),
  ]
  const issues: EntryIntegrityIssue[] = []
  for (const [key, entry] of declared) {
    const actual = hashOf(files.get(entry.path))
    if (actual !== entry.sha256) {
      issues.push({ key, path: entry.path, expected: entry.sha256, actual })
    }
  }
  return issues
}

/** 文件字节 sha256 小写十六进制；缺失文件返回全 0 占位（由调用方判定缺失）。 */
export function hashOf(bytes: Uint8Array | undefined): string {
  if (bytes === undefined) return '0'.repeat(64)
  return bytesToHex(sha256(bytes))
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : JSON.stringify(cause)
}