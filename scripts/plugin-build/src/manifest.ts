import type { PluginManifest } from '@delta-comic/protocol'
import { validateManifest } from '@delta-comic/protocol'

export interface HashedEntry {
  /** zip 内相对路径。 */
  path: string
  /** 内容 sha256（小写十六进制）。 */
  sha256: string
}

export interface AssembleManifestInput {
  id: string
  name?: string
  version: string
  hostVersion: string
  capabilities: readonly string[]
  network: { multiEdge: boolean }
  runtime: {
    rn: string
    hermes: string
    bytecode: number
    cpu: readonly string[]
    compileOptions?: Record<string, string>
  }
  dependencies?: readonly string[]
  entries: { common: HashedEntry } & Partial<
    Record<'web' | 'android' | 'macos' | 'windows', HashedEntry>
  >
}

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/**
 * 组装并校验插件 manifest。
 * compileOptions 缺省补空记录；校验失败抛出含全部 issue 的 ManifestError。
 */
export function assembleManifest(input: AssembleManifestInput): PluginManifest {
  const candidate = {
    id: input.id,
    ...(input.name === undefined ? {} : { name: input.name }),
    version: input.version,
    hostVersion: input.hostVersion,
    entries: input.entries,
    runtime: {
      rn: input.runtime.rn,
      hermes: input.runtime.hermes,
      bytecode: input.runtime.bytecode,
      cpu: [...input.runtime.cpu],
      compileOptions: input.runtime.compileOptions ?? {},
    },
    network: { multiEdge: input.network.multiEdge },
    capabilities: [...input.capabilities],
    ...(input.dependencies === undefined ? {} : { dependencies: [...input.dependencies] }),
  }
  const result = validateManifest(candidate)
  if (!result.ok) {
    throw new ManifestError(
      `manifest 校验失败：\n${result.issues.map(i => `${i.path}: ${i.message}`).join('\n')}`,
    )
  }
  return result.manifest
}