/**
 * Delta Comic 核心协议包。
 *
 * 职责（Phase 3 实现）：
 * - plugin manifest TypeBox schema 与运行时校验
 * - plugin contract 公开 interface（player 输入协议 module augmentation 挂点）
 * - UIRegistry 类型基线与分层 key 约定
 *
 * 协议版本与宿主 semver 保持一致，不做独立 protocolVersion。
 *
 * Phase 7 新增 Dev MCP 调试通道线协议（debug.ts），应用侧与工具侧共享校验源。
 */
export { protocolVersion } from './version'

export * from './manifest'
export * from './contract'
export * from './ui'
export * from './debug'