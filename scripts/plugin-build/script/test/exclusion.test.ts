import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { scanFiles, scanZip } from '../../src/exclusion.ts'
import { createZip } from '../../src/zip.ts'

describe('scanFiles', () => {
  it('命中标记返回文件与标记', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcb-excl-'))
    const file = join(dir, 'bundle.js')
    await writeFile(file, '// delta-comic.debug\nexport {}\n', 'utf8')
    const clean = join(dir, 'clean.js')
    await writeFile(clean, 'export {}\n', 'utf8')
    const hits = await scanFiles([file, clean], ['delta-comic.debug'])
    expect(hits).toEqual([{ file, marker: 'delta-comic.debug' }])
  })

  it('无命中返回空数组', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcb-excl-'))
    const clean = join(dir, 'clean.js')
    await writeFile(clean, 'export {}\n', 'utf8')
    const hits = await scanFiles([clean], ['marker'])
    expect(hits).toEqual([])
  })
})

describe('scanZip', () => {
  it('扫描 zip 成员文本命中标记', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcb-excl-'))
    const file = join(dir, 'plugin.zip')
    await writeFile(
      file,
      createZip({ 'common/index.js': new TextEncoder().encode('// dev-debug marker') }),
    )
    const hits = await scanZip(file, ['dev-debug'])
    expect(hits).toEqual([{ file: `${file}#common/index.js`, marker: 'dev-debug' }])
  })
})