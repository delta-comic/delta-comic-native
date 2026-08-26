/**
 * home 路由声明：首页以 'core/home' 注册为底部导航首个常规槽。
 */
import type { RouteRegistryService } from '@delta-comic/navigation'

import { HomeScreen, type HomeScreenProps } from './home-screen'

export const HOME_ROUTE_KEY = 'core/home'

export interface HomeRouteParams {}

declare module '@delta-comic/navigation' {
  interface Routes {
    home: HomeRouteParams
  }
}

export interface RegisterHomeOptions extends HomeScreenProps {}

/** 将首页注册进路由注册表；返回注销 disposer。 */
export function registerHomeScreen(
  routeRegistry: RouteRegistryService,
  options: RegisterHomeOptions,
) {
  return routeRegistry.register({
    id: 'core',
    version: '1.0.0',
    routeName: 'home',
    screen: () => <HomeScreen {...options} />,
  })
}