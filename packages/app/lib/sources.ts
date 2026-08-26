/**
 * zip 目录插件来源：扫描目录内 *.zip，经 @delta-comic/runtime 发现。
 * 文件系统差异（node fs / RN 桥 / fetch）由 PackageFs 注入；
 * 单个损坏包跳过并回报 onError，不拖垮整个来源。
 */
import type { PluginSource } from '@delta-comic/loader'
import {
  discoverFromArtifact,
  type ModuleEvaluator,
  type TargetPlatform,
} from '@delta-comic/runtime'

export interface PackageFs {
  /** 列出目录内全部 .zip 文件名（不含目录前缀）。 */
  listZips(dir: string): Promise<readonly string[]>
  readFile(path: string): Promise<Uint8Array>
  remove?(path: string): Promise<void>
}

export interface ZipDirSourceOptions {
  readonly stage: 'official' | 'user'
  readonly dir: string
  readonly fs: PackageFs
  readonly platform: TargetPlatform
  readonly evaluator: ModuleEvaluator
  /** 单包发现失败回调（结构损坏/sha256 不符）。 */
  readonly onError?: (name: string, cause: unknown) => void
}

export function createZipDirSource(options: ZipDirSourceOptions): PluginSource {
  const prefix =
    options.dir.length === 0 || options.dir.endsWith('/') ? options.dir : `${options.dir}/`
  return {
    stage: options.stage,
    async discover() {
      const names = await options.fs.listZips(options.dir)
      const found = []
      for (const name of names) {
        try {
          const zip = await options.fs.readFile(`${prefix}${name}`)
          found.push(
            discoverFromArtifact(zip, { platform: options.platform, evaluator: options.evaluator }),
          )
        } catch (cause) {
          options.onError?.(name, cause)
        }
      }
      return found
    },
    async uninstall(id) {
      await options.fs.remove?.(`${prefix}${id}.zip`)
    },
  }
}