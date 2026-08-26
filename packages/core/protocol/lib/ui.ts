/**
 * UIRegistry 类型基线与分层 key 约定。
 *
 * - key 分层命名 'layer/name'，如 'ui/button'、'ui/banner'
 * - 各 key 的组件类型由宿主与插件经 module augmentation 声明到 UIRegistry
 * - 注册/覆盖描述符在此定义，UIRegistryService 实现位于 registry 包
 */
export interface UIRegistry {}

const LAYERED_KEY_PATTERN = /^[a-z][a-z0-9]*(?:\/[a-z][a-z0-9-]*)+$/

/** 分层 key 形态约定：至少两层，段内小写字母数字（name 段可带连字符）。 */
export function isValidLayeredKey(key: string): boolean {
  return LAYERED_KEY_PATTERN.test(key)
}

/** 校验分层 key：至少两层，段内小写字母数字（name 段可带连字符）。 */
export const isValidUiKey = isValidLayeredKey

export interface UIBaseRegistration<T> {
  /** 注册条目 ID，同 key 内唯一，通常为来源插件 ID。 */
  readonly id: string
  /** 条目自身版本（semver）。 */
  readonly version: string
  readonly component: T
  /** 覆盖仲裁优先级，默认 0。 */
  readonly priority?: number
}

export interface UIOverrideSpec {
  /** 被覆盖条目 ID（同 key 下）。 */
  readonly targetId: string
  /** 目标条目需满足的 semver range。 */
  readonly compatibleVersion: string
}

export interface UIOverrideRegistration<T> extends UIBaseRegistration<T> {
  readonly override: UIOverrideSpec
}

export type UIRegistration<T> = UIBaseRegistration<T> | UIOverrideRegistration<T>

export function isUIOverrideRegistration<T>(
  registration: UIRegistration<T>,
): registration is UIOverrideRegistration<T> {
  return 'override' in registration
}