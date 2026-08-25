import type { Context } from 'cordis'

/**
 * Delta Comic 注册中心插件。
 *
 * 职责（Phase 3 实现）：
 * - UIRegistryService：类型化 get<K extends keyof UIRegistry>(key: K)
 * - RouteRegistry + module augmentation 基线
 * - 覆盖声明（目标 key / 兼容版本 / 优先级）的运行时校验
 */
export function apply(_ctx: Context): void {}