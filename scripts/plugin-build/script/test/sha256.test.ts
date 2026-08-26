import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bytesSha256, fileSha256 } from '../../src/sha256.ts'

describe('sha256', () => {
  it('对字节内容给出小写十六进制摘要', () => {
    const data = new TextEncoder().encode('abc')
    expect(bytesSha256(data)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('文件摘要与内容摘要一致', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dcb-sha-'))
    const file = join(dir, 'blob.bin')
    const data = new Uint8Array([1, 2, 3, 250])
    await writeFile(file, data)
    expect(await fileSha256(file)).toBe(bytesSha256(data))
  })
})