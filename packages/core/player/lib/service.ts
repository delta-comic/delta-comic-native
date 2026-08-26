/**
 * Player 注册与解析服务（architecture.md §3.6）。
 *
 * - 插件按 PlayerInputRegistry 声明的 key 注册 provider，协议版本必须为合法 semver
 * - resolve 递归展开 redirect 链：每跳按注册的 TypeBox schema 校验输入，
 *   visited 判环，深度上限 MAX_REDIRECT_DEPTH；任何失败立即关闭已建 scope 再抛错
 * - 禁止自动 fallback：missing/invalid/cycle/depth 均以 PlayerResolveError fail loud
 */
import { Service, type Context, type Disposable } from 'cordis'
import { valid } from 'semver'
import { Value } from 'typebox/value'

import { ResourceScope } from '@delta-comic/resource'
import type {
  PlayerInput,
  PlayerInputDefinition,
  PlayerInstance,
  PlayerKey,
  PlayerResolveResult,
} from '@delta-comic/protocol'

/** redirect 递归最大深度（含起点与终点的跳数上限）。 */
export const MAX_REDIRECT_DEPTH = 8

export type PlayerResolveErrorCode =
  | 'player-missing'
  | 'input-invalid'
  | 'redirect-cycle'
  | 'redirect-depth'

export class PlayerResolveError extends Error {
  constructor(
    readonly code: PlayerResolveErrorCode,
    readonly key: string,
    /** 解析路径：起点至出错位置的全部协议 key。 */
    readonly chain: readonly string[],
  ) {
    super(`${PLAYER_ERROR_MESSAGE[code]}：${key}`)
    this.name = 'PlayerResolveError'
  }
}

const PLAYER_ERROR_MESSAGE: Record<PlayerResolveErrorCode, string> = {
  'player-missing': 'player 未注册',
  'input-invalid': 'player 输入未通过协议校验',
  'redirect-cycle': 'player 重定向成环',
  'redirect-depth': 'player 重定向超过最大深度',
}

export interface PlayerProvider<K extends PlayerKey = PlayerKey> {
  readonly key: K
  readonly definition: PlayerInputDefinition
  resolve(input: PlayerInput<K>): Promise<PlayerResolveResult>
}

/**
 * 擦除后的单步结果别名：redirect 目标 key 与输入经存在类型边界收窄为
 * string + unknown，由协议映射联合在编译期保证配对关系。
 */
export type PlayerResolveStep = PlayerResolveResult

interface RegisteredPlayer {
  readonly definition: PlayerInputDefinition
  readonly resolve: (input: never) => Promise<PlayerResolveStep>
}

/** 解析成功产物：实例与其专属资源作用域，宿主负责在卸载时关闭 scope。 */
export interface ResolvedPlayer {
  readonly instance: PlayerInstance
  readonly scope: ResourceScope
}

export interface PlayerResolvedEvent {
  readonly key: string
  readonly providerId: string
  /** 解析路径：起点到终点的全部协议 key，含终点。 */
  readonly chain: readonly string[]
}

export interface PlayerServiceOptions {
  /** scope 工厂注入点；缺省 new ResourceScope()。 */
  readonly createScope?: () => ResourceScope
}

export class PlayerService extends Service {
  private readonly players = new Map<string, RegisteredPlayer>()
  private readonly createScope: () => ResourceScope

  constructor(ctx: Context, options?: PlayerServiceOptions) {
    super(ctx, 'players')
    this.createScope = options?.createScope ?? (() => new ResourceScope())
  }

  /**
   * 注册 player；key 重复或版本非法抛错。
   * K 与 PlayerInputRegistry 的绑定关系由本签名静态保证，
   * 存储层擦除后由 resolve 循环内的 schema 校验兜底。
   */
  registerPlayer<K extends PlayerKey>(provider: PlayerProvider<K>): Disposable {
    if (!valid(provider.definition.version)) {
      throw new TypeError(`player 协议版本不是合法 semver：${provider.definition.version}`)
    }
    if (this.players.has(provider.key)) throw new Error(`player 注册重复：${provider.key}`)
    this.players.set(provider.key, {
      definition: provider.definition,
      resolve: input => provider.resolve(input),
    })
    return () => {
      this.players.delete(provider.key)
    }
  }

  /** 已注册协议 key，确定性排序。 */
  keys(): string[] {
    return [...this.players.keys()].sort()
  }

  /**
   * 解析到播放器实例：递归展开 redirect 并逐跳校验；
   * 失败路径先关闭 scope 再抛 PlayerResolveError。
   */
  async resolve<K extends PlayerKey>(key: K, input: PlayerInput<K>): Promise<ResolvedPlayer> {
    return this.resolveErased(key, input)
  }

  /**
   * 类型擦除还原点：宿主与路由层持有的是运行期字符串 key 与 unknown 输入，
   * 无法静态绑定注册表；运行期由 schema 校验与 missing 检查 fail loud 兜底。
   */
  async resolveErased(key: string, input: unknown): Promise<ResolvedPlayer> {
    const scope = this.createScope()
    const chain: string[] = [key]
    const visited = new Set<string>([key])
    let cursor: { key: string; input: unknown } = { key, input }
    try {
      for (;;) {
        if (chain.length > MAX_REDIRECT_DEPTH) {
          throw new PlayerResolveError('redirect-depth', cursor.key, chain)
        }
        const registered = this.players.get(cursor.key)
        if (registered === undefined) {
          throw new PlayerResolveError('player-missing', cursor.key, chain)
        }
        // 还原点：schema 校验是擦除后的运行时安全边界；unknown 输入无法静态证明
        // 匹配各异构 schema，校验通过后仍以 unknown 流转，交由 provider 签名承担。
        if (!Value.Check(registered.definition.schema, cursor.input)) {
          throw new PlayerResolveError('input-invalid', cursor.key, chain)
        }
        const step = await registered.resolve(cursor.input as never)
        if (step.kind === 'instance') {
          this.ctx.emit('player/resolved', {
            key,
            providerId: step.instance.providerId,
            chain: [...chain],
          })
          return { instance: step.instance, scope }
        }
        if (visited.has(step.key)) {
          throw new PlayerResolveError('redirect-cycle', step.key, [...chain, step.key])
        }
        visited.add(step.key)
        chain.push(step.key)
        cursor = { key: step.key, input: step.input }
      }
    } catch (error) {
      await scope.close()
      throw error
    }
  }
}

declare module 'cordis' {
  interface Events {
    /** player 解析成功广播，携带完整重定向链。 @mode emit */
    'player/resolved'(event: PlayerResolvedEvent): void
  }

  interface Context {
    players: PlayerService
  }
}
