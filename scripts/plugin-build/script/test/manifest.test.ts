import { validateManifest } from '@delta-comic/protocol'
import { describe, expect, it } from 'vitest'

import { ManifestError, assembleManifest } from '../../src/manifest.ts'

function input() {
  return {
    id: 'fixture-plugin',
    name: 'Fixture Plugin',
    version: '1.2.3',
    hostVersion: '^1.0.0',
    capabilities: ['dev-debug'],
    network: { multiEdge: false },
    runtime: { rn: '>=0.81.0', hermes: '>=2024.6.20-alpha', bytecode: 96, cpu: ['arm64'] },
    entries: { common: { path: 'common/index.js', sha256: 'a'.repeat(64) } },
  }
}

describe('assembleManifest', () => {
  it('补齐 compileOptions 缺省并通过 validateManifest', () => {
    const manifest = assembleManifest(input())
    expect(manifest.runtime.compileOptions).toEqual({})
    expect(validateManifest(manifest)).toMatchObject({ ok: true })
  })

  it('非法 semver range 抛出含 issue 明细的 ManifestError', () => {
    expect(() => assembleManifest({ ...input(), hostVersion: 'not-a-range' })).toThrowError(
      ManifestError,
    )
  })

  it('非法结构抛出 ManifestError', () => {
    expect(() => assembleManifest({ ...input(), id: 'Bad_ID' })).toThrowError(ManifestError)
  })
})