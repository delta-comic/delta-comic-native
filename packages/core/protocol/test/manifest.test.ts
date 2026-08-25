import { describe, expect, it } from 'vitest'

import { validateManifest } from '../lib/index'

const sha256 = 'a'.repeat(64)

function baseManifest() {
  return {
    id: 'sample',
    version: '1.2.3',
    hostVersion: '>=1.0.0 <2.0.0',
    entries: { common: { path: 'index.js', sha256 } },
    fallback: { path: 'fallback.js', sha256 },
    runtime: {
      rn: '^0.87.0',
      hermes: '^2026.1.0',
      bytecode: 96,
      cpu: ['arm64', 'x64'],
      compileOptions: { dev: 'false' },
    },
    network: { multiEdge: true },
    capabilities: ['clipboard'],
  }
}

function issuePaths(value: unknown): string[] {
  const result = validateManifest(value)
  if (result.ok) return []
  return result.issues.map(issue => issue.path)
}

describe('manifest 校验', () => {
  it('合法 manifest 通过并返回强类型值', () => {
    const result = validateManifest(baseManifest())
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ manifest: { id: 'sample', network: { multiEdge: true } } })
  })

  it('插件 ID 必须是单段 kebab-case', () => {
    for (const id of ['Sample', 'sample--x', '-sample']) {
      const manifest = { ...baseManifest(), id }
      expect(validateManifest(manifest).ok).toBe(false)
      expect(issuePaths(manifest).some(path => path.includes('id'))).toBe(true)
    }
  })

  it('common 入口必填且未知平台被拒绝', () => {
    const missing = baseManifest()
    delete (missing.entries as Record<string, unknown>).common
    expect(issuePaths(missing).some(path => path.includes('entries'))).toBe(true)

    const unknown = baseManifest()
    ;(unknown.entries as Record<string, unknown>).tvos = { path: 'x.js', sha256 }
    expect(issuePaths(unknown).some(path => path.includes('entries'))).toBe(true)
  })

  it('入口 sha256 必须是小写十六进制 64 位', () => {
    const manifest = baseManifest()
    manifest.entries.common.sha256 = sha256.slice(0, 63)
    expect(issuePaths(manifest).some(path => path.includes('sha256'))).toBe(true)
  })

  it('version 必须是 semver', () => {
    const manifest = { ...baseManifest(), version: '1.2' }
    expect(issuePaths(manifest).some(path => path.includes('version'))).toBe(true)
  })

  it('hostVersion 与 runtime 版本范围必须是合法 semver range', () => {
    const host = { ...baseManifest(), hostVersion: 'not a range' }
    expect(issuePaths(host)).toContain('/hostVersion')

    const rn = baseManifest()
    rn.runtime.rn = '^abc'
    expect(issuePaths(rn)).toContain('/runtime/rn')
  })

  it('multiEdge 开关类型错误被报告', () => {
    const manifest = baseManifest()
    ;(manifest.network as Record<string, unknown>).multiEdge = 'yes'
    expect(issuePaths(manifest).some(path => path.includes('multiEdge'))).toBe(true)
  })
})