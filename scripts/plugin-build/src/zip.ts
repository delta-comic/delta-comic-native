import { readFile } from 'node:fs/promises'

import { unzipSync, zipSync } from 'fflate'

/** zip 成员表：zip 内相对路径 → 内容字节。 */
export type ZipInputs = Record<string, Uint8Array>

/** 将成员表打包为 zip 字节流（deflate）。 */
export function createZip(inputs: ZipInputs): Uint8Array {
  return zipSync(inputs, { level: 6 })
}

/** 读取 zip 文件为成员表。 */
export async function readZip(path: string): Promise<ZipInputs> {
  return readZipBytes(new Uint8Array(await readFile(path)))
}

/** 读取 zip 字节流为成员表（测试与校验用）。 */
export function readZipBytes(data: Uint8Array): ZipInputs {
  return unzipSync(data)
}