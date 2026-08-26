/**
 * 插件契约公开 interface。
 *
 * - player：输入协议经 module augmentation 注册到 PlayerInputRegistry，
 *   解析结果只允许 instance 或 redirect(key, convertedInput)，语义自动 fallback 被禁止
 * - edge：EdgeRouter 端点候选由插件 resolveEdges(ctx) hook 运行时产出，
 *   manifest 仅携带 network.multiEdge 开关
 */
import type { Context } from 'cordis'
import type { ReactNode } from 'react'
import type { Static, TSchema } from 'typebox'

/** player 输入协议注册挂点：插件以 declare module 扩展本接口，key 为协议 key。 */
export interface PlayerInputRegistry {}

/** 输入协议定义：schema 为 TypeBox schema，运行时按其校验转换后的输入。 */
export interface PlayerInputDefinition<T extends TSchema = TSchema> {
  readonly schema: T
  readonly version: string
}

export type PlayerProtocolOf<K extends keyof PlayerInputRegistry> = PlayerInputRegistry[K]

export type PlayerInput<K extends keyof PlayerInputRegistry> = Static<PlayerProtocolOf<K>['schema']>

/** 解析终点的播放器实例：render 产出 RN UI，dispose 由宿主在卸载时调用。 */
export interface PlayerInstance {
  readonly providerId: string
  render(): ReactNode
  dispose?(): void | Promise<void>
}

/**
 * 单次解析结果：返回实例，或重定向到另一协议 key 并给出转换后的输入。
 * 重定向链由宿主递归解析并校验循环与最大深度。
 */
export type PlayerResolveResult<K extends keyof PlayerInputRegistry> =
  | { readonly kind: 'instance'; readonly instance: PlayerInstance }
  | { readonly kind: 'redirect'; readonly key: K; readonly input: PlayerInput<K> }

export interface Edge {
  /** 端点基准 URL，以 / 结尾与否由实现归一化。 */
  readonly baseUrl: string
  readonly label?: string
}

/** 插件产出端点候选的 hook 契约；ctx 为加载该插件的 Cordis 上下文。 */
export type ResolveEdgesHook = (ctx: Context) => Promise<Edge[]>

declare module 'cordis' {
  interface Events {
    /** EdgeRouter 选中端点变更广播；全灭时为 null。 @mode emit */
    'protocol/edge-changed'(edge: Edge | null): void
  }
}