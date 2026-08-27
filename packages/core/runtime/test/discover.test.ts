import type { DiscoveredPlugin } from '@delta-comic/loader'
import { validateManifest } from '@delta-comic/protocol'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { ArtifactError, openPluginArtifact } from '../lib/artifact.ts'
import { discoverFromArtifact } from '../lib/discover.ts'
import type { EntryInput, ModuleEvaluator } from '../lib/evaluator.ts'

import { makeFixture } from './util.ts'

function fakeEvaluator(marker: unknown): ModuleEvaluator & { calls: EntryInput[] } {
  const calls: EntryInput[] = []
  return Object.assign(
    async (input: EntryInput) => {
      calls.push(input)
      return { default: marker }
    },
    { calls },
  )
}

describe('discoverFromArtifact', () => {
  it('产出通过校验的 manifest 与排序后的迁移', () => {
    const { zip } = makeFixture()
    const discovered = discoverFromArtifact(zip, {
      platform: 'web',
      evaluator: fakeEvaluator(null),
    })
    const checked = validateManifest(discovered.manifest)
    expect(checked.ok).toBe(true)
    expect(discovered.migrations).toEqual([
      {
        pluginId: 'demo',
        n: 1,
        name: 'init',
        up: 'create table demo_v1(id text);',
        down: 'drop table demo_v1;',
      },
    ])
  })

  it('resolveEntry 走平台覆盖入口并返回 default 导出', async () => {
    const { zip } = makeFixture({ webEntry: true })
    const evaluator = fakeEvaluator({ apply() {} })
    const discovered = discoverFromArtifact(zip, { platform: 'web', evaluator })
    const plugin = await discovered.resolveEntry()
    expect(plugin).toBeDefined()
    expect(evaluator.calls[0]?.path).toBe('web/index.js')
  })

  it('无平台覆盖时回落 common', async () => {
    const { zip } = makeFixture()
    const evaluator = fakeEvaluator({ apply() {} })
    const discovered: DiscoveredPlugin = discoverFromArtifact(zip, {
      platform: 'android',
      evaluator,
    })
    await discovered.resolveEntry()
    expect(evaluator.calls[0]?.path).toBe('common/index.js')
  })

  it('声明入口文件在包内缺失时发现阶段抛 entry-missing', () => {
    const { manifest } = makeFixture({ webEntry: true })
    const rebuilt = rebuildZip(manifest, originalFiles => {
      const files = new Map(originalFiles)
      files.delete('web/index.js')
      return files
    })
    const error = catchOf(() =>
      discoverFromArtifact(rebuilt, { platform: 'web', evaluator: fakeEvaluator(null) }),
    )
    expect((error as ArtifactError).code).toBe('entry-missing')
  })

  it('入口缺少 default 导出报错', async () => {
    const { zip } = makeFixture()
    const empty: ModuleEvaluator = async () => ({})
    const discovered = discoverFromArtifact(zip, { platform: 'web', evaluator: empty })
    await expect(discovered.resolveEntry()).rejects.toBeInstanceOf(ArtifactError)
  })

  it('manifest 结构非法当场抛 manifest 错误', () => {
    const { manifest } = makeFixture()
    const broken = rebuildZip({ ...manifest, version: 'not-semver' })
    const error = catchOf(() =>
      discoverFromArtifact(broken, { platform: 'web', evaluator: fakeEvaluator(null) }),
    )
    expect((error as ArtifactError).code).toBe('manifest')
  })

  it('迁移缺 down 文件抛 manifest 错误', () => {
    const { manifest } = makeFixture()
    const rebuilt = rebuildZip(manifest, files => {
      files.set('migrations/0002-orphan.up.sql', strToU8('select 1;'))
      return files
    })
    const error = catchOf(() =>
      discoverFromArtifact(rebuilt, { platform: 'web', evaluator: fakeEvaluator(null) }),
    )
    expect((error as ArtifactError).code).toBe('manifest')
  })
})

/** 捕获同步调用抛错（no-conditional-expect 友好）。 */
function catchOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

/** 以原包文件为基础重建 zip：manifest 可替换，文件表可变换（保持字节一致以通过校验）。 */
function rebuildZip(
  manifestOverride: Record<string, unknown>,
  transform?: (files: Map<string, Uint8Array>) => Map<string, Uint8Array>,
): Uint8Array {
  const { zip } = makeFixture()
  const base = openPluginArtifact(zip)
  const files = new Map(base.files)
  const finalFiles = transform === undefined ? files : transform(files)
  return zipSync({
    ...Object.fromEntries(finalFiles),
    'manifest.json': strToU8(JSON.stringify(manifestOverride)),
  })
}