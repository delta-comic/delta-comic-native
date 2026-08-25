/**
 * Delta Comic 核心协议包。
 *
 * 职责（Phase 3 实现）：
 * - plugin manifest TypeBox schema 与运行时校验
 * - plugin contract 公开 interface（player 输入协议 module augmentation 挂点）
 * - UIRegistry / RouteRegistry 类型基线与分层 key 约定
 *
 * 协议版本与宿主 semver 保持一致，不做独立 protocolVersion。
 */
export const protocolVersion = '1.0.0'