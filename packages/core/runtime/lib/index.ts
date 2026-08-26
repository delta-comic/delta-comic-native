/**
 * 插件运行时抽象包：plugin.zip 工件层（解压/校验/平台入口选择）
 * 与入口求值缝隙（Hermes/JSI 细节由各端实现封装，协议面不暴露）。
 */
export * from './artifact.ts'
export * from './evaluator.ts'
export * from './discover.ts'