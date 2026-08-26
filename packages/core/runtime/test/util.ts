import type { PluginManifest } from '@delta-comic/protocol'
import { strToU8, zipSync } from 'fflate'

import { hashOf } from '../lib/artifact.ts'

export interface FixtureFiles {
  readonly [path: string]: string
}

export interface FixtureResult {
  readonly zip: Uint8Array
  readonly manifest: PluginManifest
}

/** 构建合法 fixture 插件包：common 入口 + 可选 web 覆盖 + 一对迁移。 */
export function makeFixture(extra?: {
  readonly webEntry?: boolean
  readonly files?: FixtureFiles
}): FixtureResult {
  const common = 'export default { apply() {} }\n'
  const web = 'export default { apply(ctx) { void ctx } }\n'
  const manifest: PluginManifest = {
    id: 'demo',
    version: '1.0.0',
    hostVersion: '>=1.0.0',
    entries: {
      common: { path: 'common/index.js', sha256: hashOf(strToU8(common)) },
      ...(extra?.webEntry === true
        ? { web: { path: 'web/index.js', sha256: hashOf(strToU8(web)) } }
        : {}),
    },
    runtime: {
      rn: '^0.87.0',
      hermes: '^2026.1.0',
      bytecode: 96,
      cpu: ['arm64'],
      compileOptions: { dev: 'false' },
    },
    network: { multiEdge: false },
    capabilities: [],
  }
  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest)),
    'common/index.js': strToU8(common),
    'migrations/0001-init.up.sql': strToU8('create table demo_v1(id text);'),
    'migrations/0001-init.down.sql': strToU8('drop table demo_v1;'),
    ...(extra?.webEntry === true ? { 'web/index.js': strToU8(web) } : {}),
    ...Object.fromEntries(
      Object.entries(extra?.files ?? {}).map(([path, body]) => [path, strToU8(body)]),
    ),
  }
  return { zip: zipSync(files), manifest }
}