import type { Context } from 'cordis'

/**
 * Delta Comic 启动 loader 插件（唯一启动锚点）。
 *
 * 职责（Phase 5 实现）：
 * - db open + core migration -> official/user 插件发现与校验
 * - 依赖图 + migration 排序 -> SQL migrations + ledger -> Cordis activation
 * - 插件状态机 discovered->...->active，失败 disabled/unavailable
 */
export function apply(_ctx: Context): void {}