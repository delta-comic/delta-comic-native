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
 * Phase 8 新增 Feed/Card 协议（feed.ts）：FeedSurface/FeedProvider/Item/ItemAction。
 * Phase 9 新增资源协议（resource.ts）：ResourceDescriptor/ResourceProvider/RangeUnsupportedError。
 * Phase 10 新增关注/搜索开放体系协议（social.ts）：SubscribableProvider/SearchProvider。
 */
export { protocolVersion } from './version.ts'

export * from './manifest.ts'
export * from './contract.ts'
export * from './ui.ts'
export * from './debug.ts'
export * from './feed.ts'
export * from './resource.ts'
export * from './social.ts'