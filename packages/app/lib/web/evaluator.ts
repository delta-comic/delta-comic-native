/**
 * Web 端入口求值器：Blob URL 动态 import 前，把裸模块标识改写为
 * Vite dev 可解析的 /@id/ 绝对路径（Blob URL 无 import map，裸标识无法解析）。
 *
 * 仅重写 ESM 静态 import 的字符串字面量；相对路径、绝对路径、URL、@/ 别名保持原样。
 */
import { createEsmEvaluator, type EntryModule, type ModuleEvaluator } from '@delta-comic/runtime'

const IMPORT_RE = /\bfrom\s+(['"])([^'"]+)\1/g

function isBare(id: string): boolean {
  return !(
    id.startsWith('.') ||
    id.startsWith('/') ||
    id.startsWith('#') ||
    id.startsWith('@/') ||
    /^[a-z][a-z0-9+.-]*:/i.test(id)
  )
}

export function createViteEsmEvaluator(): ModuleEvaluator {
  const base = createEsmEvaluator()
  return async entry => {
    if (entry.path.endsWith('.hbc')) {
      throw new Error(`Web 平台无法求值 Hermes 字节码入口：${entry.path}`)
    }
    const source = new TextDecoder().decode(entry.bytes)
    const origin = globalThis.location.origin
    const rewritten = source.replace(IMPORT_RE, (match, quote: string, id: string) => {
      if (!isBare(id)) return match
      return `from ${quote}${origin}/@id/${id}${quote}`
    })
    return (await base({
      path: entry.path,
      bytes: new TextEncoder().encode(rewritten),
    })) as EntryModule
  }
}