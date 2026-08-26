import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { PluginManifest } from '@delta-comic/protocol'

import { runBundles, type BundleSpec, type PackRunner } from './bundle.ts'
import { parseBuildConfig, type PluginBuildConfig } from './config.ts'
import { emitBytecode, type CommandRunner } from './hermes.ts'
import { assembleManifest, type HashedEntry } from './manifest.ts'
import { fileSha256 } from './sha256.ts'
import { createZip, type ZipInputs } from './zip.ts'

const BYTECODE_SUFFIX = '.hbc'

export interface PackPluginOptions {
  /** 插件包目录（含 plugin.build.json 与 lib/）。 */
  pluginDir: string
  /** 配置文件路径，默认 <pluginDir>/plugin.build.json。 */
  configPath?: string
  /** 产物输出目录，默认 <pluginDir>/build。 */
  outDir?: string
  /** 覆盖配置中的 hermesc 路径。 */
  hermesc?: string
  /** vp pack 委托执行器（测试可注入 fake）。 */
  runPack?: PackRunner
  /** hermesc 执行器（测试可注入 fake）。 */
  runBytecode?: CommandRunner
}

export interface PackResult {
  zipPath: string
  manifest: PluginManifest
  /** zip 成员路径列表（不含 manifest.json 之外排序保证）。 */
  files: readonly string[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function specsOf(config: PluginBuildConfig): BundleSpec[] {
  const specs: BundleSpec[] = [
    {
      platform: 'common',
      entry: config.entries.common.entry,
      outDir: config.entries.common.outDir ?? 'dist',
    },
  ]
  for (const platform of ['web', 'android', 'macos', 'windows'] as const) {
    const entry = config.entries[platform]
    if (entry === undefined) continue
    specs.push({ platform, entry: entry.entry, outDir: entry.outDir ?? `dist-${platform}` })
  }
  return specs
}

/**
 * 插件打包流水线：bundle → 可选 Hermes 字节码 → 逐文件 sha256 →
 * manifest 组装校验 → 收集 migrations → 写出 plugin.zip。
 */
export async function packPlugin(options: PackPluginOptions): Promise<PackResult> {
  const pluginDir = resolve(options.pluginDir)
  const configPath = options.configPath ?? join(pluginDir, 'plugin.build.json')
  const buildOutDir = options.outDir ?? join(pluginDir, 'build')

  const config = parseBuildConfig(JSON.parse(await readFile(configPath, 'utf8')))
  const effective = options.hermesc === undefined ? config : { ...config, hermesc: options.hermesc }
  const outputs = runBundles(pluginDir, specsOf(effective), options.runPack)

  // 产物收集：zip 内路径 → 文件系统绝对路径。
  const artifacts = new Map<string, string>()
  for (const output of outputs) {
    const jsAbs = join(pluginDir, output.jsPath)
    artifacts.set(`${output.platform}/index.js`, jsAbs)
    for (const extra of [output.mapPath, output.dtsPath]) {
      if (extra === undefined) continue
      const abs = join(pluginDir, extra)
      if (await exists(abs)) artifacts.set(`${output.platform}/${extra.split('/').pop()}`, abs)
    }
  }

  let bytecodePath: string | undefined
  if (effective.hermesc !== undefined) {
    const input = artifacts.get('common/index.js')
    if (input === undefined) throw new Error('common bundle 缺失，无法发射字节码')
    bytecodePath = join(pluginDir, 'dist', `index${BYTECODE_SUFFIX}`)
    emitBytecode({ hermesc: effective.hermesc, input, output: bytecodePath }, options.runBytecode)
    artifacts.set(`common/index${BYTECODE_SUFFIX}`, bytecodePath)
  }

  const migrationsDir = join(pluginDir, 'migrations')
  if (await exists(migrationsDir)) {
    for (const name of (await readdir(migrationsDir)).sort()) {
      artifacts.set(`migrations/${name}`, join(migrationsDir, name))
    }
  }

  const hashed = new Map<string, HashedEntry>()
  for (const [zipPath, file] of artifacts) {
    hashed.set(zipPath, { path: zipPath, sha256: await fileSha256(file) })
  }

  const common = hashed.get('common/index.js')
  if (common === undefined) throw new Error('common bundle 产物缺失')
  const web = hashed.get('web/index.js')
  const bytecode =
    bytecodePath === undefined ? undefined : hashed.get(`common/index${BYTECODE_SUFFIX}`)

  const manifest = assembleManifest({
    id: config.id,
    ...(config.name === undefined ? {} : { name: config.name }),
    version: config.version,
    hostVersion: config.hostVersion,
    capabilities: config.capabilities,
    network: config.network,
    runtime: config.runtime,
    ...(config.dependencies === undefined ? {} : { dependencies: config.dependencies }),
    entries: {
      common,
      ...(web === undefined ? {} : { web }),
      ...(bytecode === undefined ? {} : { android: bytecode, macos: bytecode, windows: bytecode }),
    },
  })
  void config

  const inputs: ZipInputs = {}
  const files: string[] = []
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  inputs['manifest.json'] = manifestBytes
  files.push('manifest.json')
  for (const [zipPath] of hashed) {
    inputs[zipPath] = new Uint8Array(await readFile(artifacts.get(zipPath)!))
    files.push(zipPath)
  }

  await mkdir(buildOutDir, { recursive: true })
  const zipPath = join(buildOutDir, 'plugin.zip')
  await writeFile(zipPath, createZip(inputs))
  return { zipPath, manifest, files }
}