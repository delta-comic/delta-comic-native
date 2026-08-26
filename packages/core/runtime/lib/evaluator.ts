/**
 * 入口求值缝隙：宿主按端注入 ModuleEvaluator 实现，
 * Hermes/JSI（bytecode 校验、加载、模块注册）细节封装在各端实现内，
 * 本协议面只暴露「入口字节 → 模块命名空间」。
 */

/** 插件入口模块命名空间：default 导出即 Cordis plugin。 */
export interface EntryModule {
  readonly default?: unknown
}

export interface EntryInput {
  /** manifest 声明的入口路径（含扩展名，可据此路由到 bytecode 求值）。 */
  readonly path: string
  readonly bytes: Uint8Array
}

export type ModuleEvaluator = (entry: EntryInput) => Promise<EntryModule>

/** Web 端实现：ESM 源码经 Blob URL 动态 import；bytecode 入口不支持（Web 无 Hermes）。 */
export function createEsmEvaluator(): ModuleEvaluator {
  return async ({ path, bytes }) => {
    if (path.endsWith('.hbc')) {
      throw new Error(`Web 平台无法求值 Hermes 字节码入口：${path}`)
    }
    const source = new TextDecoder().decode(bytes)
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    try {
      return (await import(/* @vite-ignore */ url)) as EntryModule
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}