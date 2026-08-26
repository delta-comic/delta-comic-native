import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createZip, readZip, readZipBytes } from '../../src/zip.ts'

describe('zip', () => {
  it('成员表打包后可读回且文本一致', () => {
    const zipped = createZip({
      'manifest.json': new TextEncoder().encode('{"id":"demo"}'),
      'common/index.js': new TextEncoder().encode('// bundle\n'),
    })
    const members = readZipBytes(zipped)
    expect(new TextDecoder().decode(members['common/index.js'])).toBe('// bundle\n')
    expect(new TextDecoder().decode(members['manifest.json'])).toBe('{"id":"demo"}')
  })

  it('readZip 支持从文件读取', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcb-zip-'))
    const file = join(dir, 'sample.zip')
    await writeFile(file, createZip({ 'a.txt': new TextEncoder().encode('hello') }))
    const members = await readZip(file)
    expect(new TextDecoder().decode(members['a.txt'])).toBe('hello')
  })
})