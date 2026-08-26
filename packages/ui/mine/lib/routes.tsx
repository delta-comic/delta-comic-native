/**
 * mine 路由声明：我的页以 'core/mine' 注册为底部导航常规槽。
 */
import type { RouteRegistryService } from '@delta-comic/navigation'

import { MineScreen, type MineScreenProps } from './mine-screen'

export const MINE_ROUTE_KEY = 'core/mine'

export interface MineRouteParams {}

declare module '@delta-comic/navigation' {
  interface Routes {
    mine: MineRouteParams
  }
}

export interface RegisterMineOptions extends MineScreenProps {}

/** 将我的页注册进路由注册表；返回注销 disposer。 */
export function registerMineScreen(
  routeRegistry: RouteRegistryService,
  options: RegisterMineOptions,
) {
  return routeRegistry.register({
    id: 'core',
    version: '1.0.0',
    routeName: 'mine',
    screen: () => <MineScreen {...options} />,
  })
}