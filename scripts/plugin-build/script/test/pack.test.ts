import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { validateManifest, type PluginManifest } from '@delta-comic/protocol'
import { describe, expect, it } from 'vitest'

import type { PackRunner } from '../../src/bundle.ts'
import { packPlugin } from '../../src/pack.ts'
import { bytesSha256 } from '../../src/sha256.ts'
import { readZip } from '../../src/zip.ts'

import { makeFixturePlugin } from './util.ts'

function manifestOf(zipMembers: Record<string, Uint8Array>): PluginManifest {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(zipMembers['manifest.json']))
  const result = validateManifest(parsed)
  if (!result.ok) throw new Error(`manifest 校验失败：${JSON.stringify(result.issues)}`)
  return result.manifest
}

function fakePack() {
  const calls: string[][] = []
  const runner: PackRunner = (pluginDir, args) => {
    calls.push([...args])
    const entry = args[0]
    const index = args.indexOf('--out-dir')
    const outDir = index >= 0 ? args[index + 1]! : 'dist'
    mkdirSync(join(pluginDir, outDir), { recursive: true })
    writeFileSync(join(pluginDir, outDir, 'index.js'), `// bundle ${entry}\n`, 'utf8')
  }
  return { calls, runner }
}

function fakeBytecode() {
  const calls: string[][] = []
  return {
    calls,
    run: (file: string, args: readonly string[]) => {
      calls.push([file, ...args])
      const output = args[args.indexOf('-out') + 1]
      const input = args[args.indexOf('-out') + 2]
      copyFileSync(input!, output!)
    },
  }
}

describe('packPlugin', () => {
  it('基线打包：仅 common 入口，manifest 通过校验且哈希一致', async () => {
    const dir = await makeFixturePlugin()
    const { calls, runner } = fakePack()
    const result = await packPlugin({ pluginDir: dir, runPack: runner })

    expect(calls).toEqual([['lib/index.ts', '--out-dir', 'dist', '--format', 'esm']])
    expect(result.files[0]).toBe('manifest.json')
    expect(result.manifest.id).toBe('fixture-plugin')
    expect(result.manifest.version).toBe('1.2.3')

    const members = await readZip(result.zipPath)
    expect(Object.keys(members).sort()).toEqual(['common/index.js', 'manifest.json'])
    const manifest = manifestOf(members)
    expect(manifest.entries.common.path).toBe('common/index.js')

    const jsOnDisk = await readFile(join(dir, 'dist', 'index.js'))
    expect(manifest.entries.common.sha256).toBe(bytesSha256(jsOnDisk))
    expect(Buffer.from(members['common/index.js'])).toEqual(jsOnDisk)
  })

  it('hermesc 存在时发射字节码，Hermes 平台入口指向 hbc', async () => {
    const dir = await makeFixturePlugin({ hermesc: '/fake/hermesc' })
    const bytecode = fakeBytecode()
    const result = await packPlugin({
      pluginDir: dir,
      runPack: fakePack().runner,
      runBytecode: bytecode.run,
    })

    expect(bytecode.calls).toEqual([
      [
        '/fake/hermesc',
        '-emit-binary',
        '-out',
        join(dir, 'dist', 'index.hbc'),
        join(dir, 'dist', 'index.js'),
      ],
    ])
    expect(result.files).toContain('common/index.hbc')
    expect(result.manifest.entries.android?.path).toBe('common/index.hbc')
    expect(result.manifest.entries.macos?.path).toBe('common/index.hbc')
    expect(result.manifest.entries.windows?.path).toBe('common/index.hbc')

    const members = await readZip(result.zipPath)
    expect(Buffer.from(members['common/index.hbc'])).toEqual(
      await readFile(join(dir, 'dist', 'index.hbc')),
    )
  })

  it('web 覆盖入口以 browser 平台独立构建并写入 manifest', async () => {
    const dir = await makeFixturePlugin({ web: true })
    const { calls, runner } = fakePack()
    const result = await packPlugin({ pluginDir: dir, runPack: runner })

    expect(calls[1]).toEqual([
      'lib/web.ts',
      '--out-dir',
      'dist-web',
      '--format',
      'esm',
      '--platform',
      'browser',
    ])
    expect(result.files).toContain('web/index.js')
    expect(result.manifest.entries.web?.path).toBe('web/index.js')
    const members = await readZip(result.zipPath)
    expect(new TextDecoder().decode(members['web/index.js'])).toBe('// bundle lib/web.ts\n')
  })

  it('收集 migrations 目录进包', async () => {
    const dir = await makeFixturePlugin()
    await mkdir(join(dir, 'migrations'), { recursive: true })
    await writeFile(join(dir, 'migrations', 'v1__init.sql'), 'CREATE TABLE demo(id);\n', 'utf8')
    const result = await packPlugin({ pluginDir: dir, runPack: fakePack().runner })
    expect(result.files).toContain('migrations/v1__init.sql')
    const members = await readZip(result.zipPath)
    expect(new TextDecoder().decode(members['migrations/v1__init.sql'])).toBe(
      'CREATE TABLE demo(id);\n',
    )
  })

  it('非法配置抛出 BuildConfigError 且不产出产物', async () => {
    const dir = await makeFixturePlugin()
    await writeFile(join(dir, 'plugin.build.json'), JSON.stringify({ id: 'Bad_ID' }), 'utf8')
    await expect(packPlugin({ pluginDir: dir, runPack: fakePack().runner })).rejects.toThrowError(
      'plugin.build.json 校验失败',
    )
  })

  it('hermesc CLI 覆盖生效于无配置路径的场景', async () => {
    const dir = await makeFixturePlugin()
    const bytecode = fakeBytecode()
    const result = await packPlugin({
      pluginDir: dir,
      runPack: fakePack().runner,
      runBytecode: bytecode.run,
      hermesc: '/override/hermesc',
    })
    expect(bytecode.calls[0]?.[0]).toBe('/override/hermesc')
    expect(result.files).toContain('common/index.hbc')
  })
})