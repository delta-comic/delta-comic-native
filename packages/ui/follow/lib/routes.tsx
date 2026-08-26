/**
 * follow 路由声明：关注页以 'core/follow' 注册为底部导航常规槽。
 */
import type { RouteRegistryService } from '@delta-comic/navigation'

import { FollowScreen, type FollowScreenProps } from './follow-screen'

export const FOLLOW_ROUTE_KEY = 'core/follow'

export interface FollowRouteParams {}

declare module '@delta-comic/navigation' {
  interface Routes {
    follow: FollowRouteParams
  }
}

/** 将关注页注册进路由注册表；返回注销 disposer。 */
export function registerFollowScreen(
  routeRegistry: RouteRegistryService,
  options: FollowScreenProps,
) {
  return routeRegistry.register({
    id: 'core',
    version: '1.0.0',
    routeName: 'follow',
    screen: () => <FollowScreen {...options} />,
  })
}