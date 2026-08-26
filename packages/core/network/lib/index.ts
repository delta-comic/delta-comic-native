/**
 * Delta Comic 网络域包（Phase 11）。
 *
 * - probe：并发轻量 GET 竞速原语（whenFirst 首胜即决 / whenSettled 全量排名）
 * - repository：plugin_endpoint 表仓储（探测状态持久化）
 * - service：EdgeRouter 选路与故障转移 + NoEdgeAvailableError 结构化错误
 */
export * from './probe'
export * from './repository'
export * from './service'
