/**
 * player 路由声明：全屏播放器以 'core/player' 注册进 Routes，
 * 由 ui-shell 的 fullScreenModal Screen 承载。
 */
import type { NavigationService } from '@delta-comic/navigation'

export const PLAYER_ROUTE_KEY = 'core/player'

export interface PlayerRouteParams {
  readonly playerKey: string
  readonly input: unknown
}

declare module '@delta-comic/navigation' {
  interface Routes {
    player: PlayerRouteParams
  }
}

/** 打开全屏播放器的唯一入口；key 未注册由运行期解析 fail loud。 */
export const openPlayer = (
  navigation: NavigationService,
  playerKey: string,
  input: unknown,
): void => {
  navigation.navigate(PLAYER_ROUTE_KEY, { playerKey, input })
}