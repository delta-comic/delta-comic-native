/**
 * search 路由声明：搜索页以 'core/search' 注册，params 可携带初始关键词。
 */
import type { NavigationService, RouteRegistryService } from '@delta-comic/navigation'

import { SearchScreen, type SearchScreenProps } from './search-screen'

export const SEARCH_ROUTE_KEY = 'core/search'

export interface SearchRouteParams {
  readonly query?: string
}

declare module '@delta-comic/navigation' {
  interface Routes {
    search: SearchRouteParams
  }
}

export interface RegisterSearchOptions extends Omit<SearchScreenProps, 'initialQuery'> {}

/** 将搜索页注册进路由注册表；返回注销 disposer。 */
export function registerSearchScreen(
  routeRegistry: RouteRegistryService,
  options: RegisterSearchOptions,
) {
  return routeRegistry.register({
    id: 'core',
    version: '1.0.0',
    routeName: 'search',
    screen: ({ params }) => <SearchScreen {...options} initialQuery={params.query} />,
  })
}

/** 打开搜索页；可携带预填关键词。 */
export const openSearch = (navigation: NavigationService, query?: string): void => {
  navigation.navigate(SEARCH_ROUTE_KEY, query === undefined ? {} : { query })
}