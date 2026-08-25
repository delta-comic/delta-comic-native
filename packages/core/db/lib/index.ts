/**
 * Delta Comic 数据层基础设施。
 *
 * 职责（Phase 4 实现）：
 * - TypeBox 表 DSL -> snapshot -> diff -> up/down .sql 编译器
 * - Static 推导 Kysely Database 类型 + Value.Check 运行时校验
 * - Plugin Migration Registry（唯一 ID / 拓扑排序 / 统一 ledger）
 * - 类型化 Repository + 统一事务 + change batch -> typed observation
 * - 四端 SQLite adapter 与雪花 ID 服务（TEXT 十进制存储）
 */
export const dbPackageVersion = '1.0.0'