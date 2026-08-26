import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

/** 计算字节内容的 sha256（小写十六进制）。 */
export function bytesSha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 计算文件内容的 sha256（小写十六进制）。 */
export async function fileSha256(path: string): Promise<string> {
  return bytesSha256(await readFile(path))
}