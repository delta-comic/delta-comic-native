import { cac } from 'cac'

import { scanFiles, scanZip } from './exclusion.ts'
import { packPlugin } from './pack.ts'

const cli = cac('dcb')

cli
  .command('pack <dir>', '打包插件为 plugin.zip（bundle → 字节码 → manifest → zip）')
  .option('--config <path>', '配置文件路径（默认 <dir>/plugin.build.json）')
  .option('--out <dir>', '产物输出目录（默认 <dir>/build）')
  .option('--hermesc <path>', '覆盖配置中的 hermesc 路径')
  .action(async (dir: string, options: { config?: unknown; out?: unknown; hermesc?: unknown }) => {
    const result = await packPlugin({
      pluginDir: dir,
      ...(typeof options.config === 'string' ? { configPath: options.config } : {}),
      ...(typeof options.out === 'string' ? { outDir: options.out } : {}),
      ...(typeof options.hermesc === 'string' ? { hermesc: options.hermesc } : {}),
    })
    console.log(`打包完成：${result.zipPath}`)
    console.log(`${result.manifest.id}@${result.manifest.version}，成员 ${result.files.length} 个`)
    for (const file of result.files) console.log(`  ${file}`)
  })

cli
  .command('verify-exclusion [...targets]', '零包含校验：文件或 plugin.zip 成员出现任一标记即失败')
  .option('--marker <value>', '标记子串，可重复', { type: [String] })
  .action(async (targets: readonly string[], options: { marker?: unknown }) => {
    const raw = options.marker
    const markers = Array.isArray(raw)
      ? raw.filter((m): m is string => typeof m === 'string')
      : typeof raw === 'string'
        ? [raw]
        : []
    if (targets.length === 0 || markers.length === 0) {
      cli.outputHelp()
      process.exitCode = 2
      return
    }
    const hits = []
    for (const target of targets) {
      hits.push(
        ...(target.endsWith('.zip')
          ? await scanZip(target, markers)
          : await scanFiles([target], markers)),
      )
    }
    if (hits.length > 0) {
      for (const hit of hits) console.error(`命中标记 '${hit.marker}'：${hit.file}`)
      console.error(`零包含校验失败：${hits.length} 处命中`)
      process.exitCode = 1
      return
    }
    console.log(`零包含校验通过（标记 ${markers.join(', ')}）`)
  })

cli.help()
cli.version('1.0.0')

try {
  cli.parse(process.argv, { run: false })
  await cli.runMatchedCommand()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}