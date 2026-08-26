import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface FixtureOptions {
  /** 写入配置的 hermesc 路径。 */
  hermesc?: string
  /** 是否声明 web 覆盖入口。 */
  web?: boolean
}

/** 在临时目录生成最小插件包：lib/index.ts + plugin.build.json。 */
export async function makeFixturePlugin(options: FixtureOptions = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dcb-fixture-'))
  await mkdir(join(dir, 'lib'), { recursive: true })
  await writeFile(
    join(dir, 'lib', 'index.ts'),
    "export const plugin = { id: 'fixture-plugin' }\n",
    'utf8',
  )
  if (options.web === true) {
    await writeFile(join(dir, 'lib', 'web.ts'), 'export const webPlugin = true\n', 'utf8')
  }
  const entries: Record<string, { entry: string }> = { common: { entry: 'lib/index.ts' } }
  if (options.web === true) entries.web = { entry: 'lib/web.ts' }
  const config = {
    id: 'fixture-plugin',
    name: 'Fixture Plugin',
    version: '1.2.3',
    hostVersion: '^1.0.0',
    capabilities: ['dev-debug'],
    network: { multiEdge: false },
    runtime: {
      rn: '>=0.81.0',
      hermes: '>=2024.6.20-alpha',
      bytecode: 96,
      cpu: ['arm64'],
      compileOptions: { dev: 'false' },
    },
    entries,
    ...(options.hermesc === undefined ? {} : { hermesc: options.hermesc }),
  }
  await writeFile(join(dir, 'plugin.build.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return dir
}