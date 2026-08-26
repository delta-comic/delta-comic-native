import { execFileSync } from 'node:child_process'

/** 参与打包的平台集合：common 必建，其余为可选 override。 */
export const BUNDLE_PLATFORMS = ['common', 'web', 'android', 'macos', 'windows'] as const

export type BundlePlatform = (typeof BUNDLE_PLATFORMS)[number]

export interface BundleSpec {
  platform: BundlePlatform
  /** 源入口文件（相对插件目录，如 lib/index.ts）。 */
  entry: string
  /** 输出目录（相对插件目录，如 dist、dist-web）。 */
  outDir: string
}

export interface BundleOutput {
  platform: BundlePlatform
  /** 产出的 JS bundle 绝对/相对插件目录路径（相对 outDir 命名恒为 index.js）。 */
  jsPath: string
  mapPath?: string
  dtsPath?: string
}

export type PackRunner = (pluginDir: string, args: readonly string[]) => void

const defaultPackRunner: PackRunner = (pluginDir, args) => {
  execFileSync('vp', ['-C', pluginDir, 'pack', ...args], { stdio: 'inherit' })
}

function argsFor(spec: BundleSpec): string[] {
  const args = [spec.entry, '--out-dir', spec.outDir, '--format', 'esm']
  if (spec.platform !== 'common') args.push('--platform', 'browser')
  return args
}

/**
 * 运行一组 bundle 构建。
 *
 * common 平台复用插件包自身的 vite.config pack 配置；
 * 平台 override 以显式入口 + 独立 outDir 构建。
 * 顺序执行以避免并行构建内存放大。
 */
export function runBundles(
  pluginDir: string,
  specs: readonly BundleSpec[],
  run: PackRunner = defaultPackRunner,
): BundleOutput[] {
  const outputs: BundleOutput[] = []
  for (const spec of specs) {
    run(pluginDir, argsFor(spec))
    const base = `${spec.outDir.replace(/\/+$/, '')}/index.js`
    outputs.push({
      platform: spec.platform,
      jsPath: base,
      mapPath: `${base}.map`,
      dtsPath: `${base.replace(/\.js$/, '.d.ts')}`,
    })
  }
  return outputs
}