import { readFile } from 'node:fs/promises'

import { readZip } from './zip.ts'

export interface ExclusionHit {
  /** 命中的文件路径（或 zip 内成员路径，带 `zip:<路径>#<成员>` 前缀形态由调用方组织）。 */
  file: string
  marker: string
}

/** 扫描一组文件是否包含任一标记子串，返回全部命中。 */
export async function scanFiles(
  files: readonly string[],
  markers: readonly string[],
): Promise<ExclusionHit[]> {
  const hits: ExclusionHit[] = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const marker of markers) {
      if (text.includes(marker)) hits.push({ file, marker })
    }
  }
  return hits
}

/** 扫描 plugin.zip 全部成员是否包含任一标记子串，返回全部命中。 */
export async function scanZip(
  zipPath: string,
  markers: readonly string[],
): Promise<ExclusionHit[]> {
  const members = await readZip(zipPath)
  const hits: ExclusionHit[] = []
  for (const [name, data] of Object.entries(members)) {
    const text = new TextDecoder().decode(data)
    for (const marker of markers) {
      if (text.includes(marker)) hits.push({ file: `${zipPath}#${name}`, marker })
    }
  }
  return hits
}