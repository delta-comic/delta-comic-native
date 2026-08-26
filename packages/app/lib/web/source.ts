/**
 * Web 端插件来源：public/runtime/ 下的 index.json 清单 + zip 拉取。
 * 开发工作流：dcb pack 产物复制进 public/runtime/ 后登记 index.json。
 */
import type { PackageFs } from '../sources.ts'

export interface RuntimeIndexEntry {
  /** 文件名（相对 runtime 目录）。 */
  readonly file: string
}

const RUNTIME_BASE = 'runtime/'

export function createWebPackageFs(): PackageFs {
  return {
    async listZips() {
      const response = await fetch(`${RUNTIME_BASE}index.json`)
      if (!response.ok) return []
      const index = (await response.json()) as { plugins?: readonly RuntimeIndexEntry[] }
      return (index.plugins ?? [])
        .map(entry => entry.file)
        .filter((file): file is string => file.endsWith('.zip'))
    },
    readFile: path => fetch(path).then(response => response.bytes()),
  }
}