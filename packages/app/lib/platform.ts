import type { LoaderDatabase, PluginSource } from '@delta-comic/loader'
import type { CrashHooks, LogSink } from '@delta-comic/plugin-observability'
import type { ModuleEvaluator } from '@delta-comic/runtime'
import type { StorageLayerAdapter } from '@delta-comic/storage'
/**
 * 宿主平台缝隙：packages/app 只面向本接口装配，
 * 各端入口（web / native bridge）负责提供具体实现。
 */
import type { Context } from 'cordis'
import type { Kysely } from 'kysely'

export interface HostSeams {
  /** 当前目标端，决定 manifest 入口选择。 */
  readonly platform: 'web' | 'android' | 'macos' | 'windows'
  /** 打开宿主数据库（loader 库投影）。 */
  createDb(): Promise<Kysely<LoaderDatabase>>
  /** 插件入口求值器（Hermes/JSI 细节封装于各端实现）。 */
  readonly evaluator: ModuleEvaluator
  /** 插件来源（official/user），由各端按安装目录/远程清单注入。 */
  readonly sources: readonly PluginSource[]
  /** 崩溃捕获钩子（RN 全局错误处理器等）；缺省不挂。 */
  readonly crashHooks?: CrashHooks
  /** 日志落盘 sink（滚动文件等）；缺省内存环形缓冲。 */
  readonly sink?: LogSink
  /** 存储治理的平台层实现（易失缓存/持久下载目录）。 */
  readonly storageLayers?: readonly StorageLayerAdapter[]
}

export interface AppHandle {
  /** 装配完成的 cordis 根上下文。 */
  readonly ctx: Context
  dispose(): Promise<void>
}