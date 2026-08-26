import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { ArtifactError, hashOf, openPluginArtifact, verifyEntries } from '../lib/artifact.ts'

import { makeFixture } from './util.ts'

/** 捕获调用抛错（no-conditional-expect 友好：断言全部置于捕获之后）。 */
function catchOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('openPluginArtifact', () => {
  it('解压并读取 manifest 与文件表', () => {
    const { zip } = makeFixture({ webEntry: true })
    const artifact = openPluginArtifact(zip)
    expect((artifact.manifest as { id: string }).id).toBe('demo')
    expect(artifact.files.get('common/index.js')).toBeDefined()
  })

  it('非 zip 字节抛 zip 错误', () => {
    const error = catchOf(() => openPluginArtifact(strToU8('not a zip')))
    expect(error).toBeInstanceOf(ArtifactError)
    expect((error as ArtifactError).code).toBe('zip')
  })

  it('缺少 manifest.json 抛 manifest 错误', () => {
    const zip = zipSync({ 'common/index.js': strToU8('x') })
    const error = catchOf(() => openPluginArtifact(zip))
    expect((error as ArtifactError).code).toBe('manifest')
  })

  it('manifest 非法 JSON 抛 manifest 错误', () => {
    const zip = zipSync({ 'manifest.json': strToU8('{oops') })
    const error = catchOf(() => openPluginArtifact(zip))
    expect((error as ArtifactError).code).toBe('manifest')
  })
})

describe('verifyEntries', () => {
  it('内容一致时无 issue', () => {
    const { zip, manifest } = makeFixture({ webEntry: true })
    const artifact = openPluginArtifact(zip)
    expect(verifyEntries(manifest, artifact.files)).toEqual([])
  })

  it('篡改入口字节后报告 sha256 不匹配', () => {
    const { zip, manifest } = makeFixture({ webEntry: true })
    const artifact = openPluginArtifact(zip)
    const tampered = new Map(artifact.files)
    tampered.set('common/index.js', strToU8('// tampered\n'))
    const issues = verifyEntries(manifest, tampered)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.key).toBe('common')
    expect(issues[0]?.actual).toBe(hashOf(tampered.get('common/index.js')))
  })

  it('入口文件缺失以全 0 摘要呈现', () => {
    const { manifest } = makeFixture()
    const issues = verifyEntries(manifest, new Map())
    expect(issues[0]?.actual).toBe('0'.repeat(64))
  })
})