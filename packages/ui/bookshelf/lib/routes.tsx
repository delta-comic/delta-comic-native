/**
 * bookshelf 路由声明：书架页以 'core/bookshelf' 注册为底部导航常规槽。
 */
import type { RouteRegistryService } from '@delta-comic/navigation'

import { BookshelfScreen, type BookshelfScreenProps } from './bookshelf-screen'

export const BOOKSHELF_ROUTE_KEY = 'core/bookshelf'

export interface BookshelfRouteParams {}

declare module '@delta-comic/navigation' {
  interface Routes {
    bookshelf: BookshelfRouteParams
  }
}

export interface RegisterBookshelfOptions extends BookshelfScreenProps {}

/** 将书架页注册进路由注册表；返回注销 disposer。 */
export function registerBookshelfScreen(
  routeRegistry: RouteRegistryService,
  options: RegisterBookshelfOptions,
) {
  return routeRegistry.register({
    id: 'core',
    version: '1.0.0',
    routeName: 'bookshelf',
    screen: () => <BookshelfScreen {...options} />,
  })
}