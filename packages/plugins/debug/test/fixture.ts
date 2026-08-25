/**
 * 调试插件测试夹具：真实服务装配（loader + database + registries）。
 */
import { DatabaseSync } from 'node:sqlite'

import { nodeSqliteDialectFrom } from '@delta-comic/db/driver'
import {
  DatabaseService,
  PluginLoaderService,
  type DiscoveredPlugin,
  type LoaderDatabase,
} from '@delta-comic/loader'
import { NavigationService, RouteRegistryService } from '@delta-comic/navigation'
import { UIRegistryService } from '@delta-comic/registry'
import { Context } from 'cordis'
import { Kysely } from 'kysely'

const SHA = '0'.repeat(64)

declare module '@delta-comic/navigation' {
  interface Routes {
    detail: Record<string, unknown>
  }
}

declare module '@delta-comic/protocol' {
  interface UIRegistry {
    'ui/banner': () => string
  }
}

export function discoveredOf(id: string): DiscoveredPlugin {
  return {
    manifest: {
      id,
      version: '1.0.0',
      hostVersion: '>=1.0.0',
      entries: { common: { path: 'index.js', sha256: SHA } },
      runtime: {
        rn: '^0.87.0',
        hermes: '^2026.1.0',
        bytecode: 96,
        cpu: ['arm64'],
        compileOptions: { dev: 'false' },
      },
      network: { multiEdge: false },
      capabilities: [],
    },
    resolveEntry: async () => () => {},
    migrations: [
      {
        pluginId: id,
        n: 1,
        name: 'init',
        up: `CREATE TABLE ${id.replaceAll('-', '_')}(id INTEGER PRIMARY KEY, label TEXT);`,
        down: `DROP TABLE ${id.replaceAll('-', '_')};`,
      },
    ],
  }
}

export interface DebugFixture {
  ctx: Context
  loader: PluginLoaderService
  db: Kysely<LoaderDatabase>
  routeRegistry: RouteRegistryService
  navigation: NavigationService
  uiRegistry: UIRegistryService
  navigateCalls: readonly string[][]
}

/** 装配真实服务栈；路由 'core/detail' 与 sample 插件可用。 */
export async function createFixture(
  plugins: readonly DiscoveredPlugin[] = [discoveredOf('sample')],
): Promise<DebugFixture> {
  const db = new Kysely<LoaderDatabase>({
    dialect: nodeSqliteDialectFrom(new DatabaseSync(':memory:')),
  })
  const ctx = new Context()
  const routeRegistry = new RouteRegistryService(ctx)
  const navigation = new NavigationService(ctx)
  const uiRegistry = new UIRegistryService(ctx)
  const navigateCalls: string[][] = []

  routeRegistry.register({ id: 'core', version: '1.0.0', routeName: 'detail', screen: () => null })
  navigation.attach({
    navigate(name) {
      navigateCalls.push([name])
    },
    goBack() {},
    canGoBack: () => false,
  })
  uiRegistry.register('ui/banner', { id: 'core', version: '1.0.0', component: () => 'banner' })

  const loader = new PluginLoaderService(ctx)
  await loader.start({ sources: [{ stage: 'user', discover: async () => plugins }], db })

  new DatabaseService(ctx, db)

  return { ctx, loader, db, routeRegistry, navigation, uiRegistry, navigateCalls }
}