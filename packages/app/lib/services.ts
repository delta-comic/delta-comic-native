/**
 * 核心服务装配清单：宿主 root 上挂载的全部官方服务。
 * class 插件经 ctx.plugin(Ref, config) 构造，config 即构造第二参。
 */
import { TimerService } from '@cordisjs/plugin-timer'
import { CapabilityService } from '@delta-comic/capability'
import { FeedService, ItemActionService } from '@delta-comic/feed'
import { HistoryService, ShelfService } from '@delta-comic/library'
import { DatabaseService, PluginLoaderService, type LoaderDatabase } from '@delta-comic/loader'
import { NavigationService, RouteRegistryService } from '@delta-comic/navigation'
import { EdgeRouterService } from '@delta-comic/network'
import { PlayerService } from '@delta-comic/player'
import { ObservabilityService } from '@delta-comic/plugin-observability'
import { UIRegistryService } from '@delta-comic/registry'
import { ResourceRuntimeService } from '@delta-comic/resource'
import { SchedulerService } from '@delta-comic/scheduler'
import { SearchService } from '@delta-comic/search'
import { SubscribableRegistryService, SubscriptionService } from '@delta-comic/social'
import { StorageService } from '@delta-comic/storage'
import type { Context } from 'cordis'
import type { Kysely } from 'kysely'

import type { HostSeams } from './platform.ts'

/** 打开数据库并挂载全部核心服务；返回宿主 db 供 loader.start 使用。 */
export async function mountCoreServices(
  ctx: Context,
  seams: HostSeams,
): Promise<Kysely<LoaderDatabase>> {
  const db = await seams.createDb()
  await ctx.plugin(DatabaseService, db)
  await ctx.plugin(PluginLoaderService)
  ctx.plugin(CapabilityService, { db })
  ctx.plugin(UIRegistryService)
  ctx.plugin(RouteRegistryService)
  ctx.plugin(NavigationService)
  ctx.plugin(FeedService)
  ctx.plugin(ItemActionService)
  ctx.plugin(SearchService)
  ctx.plugin(SubscribableRegistryService)
  await ctx.plugin(SubscriptionService, db)
  await ctx.plugin(HistoryService, db)
  await ctx.plugin(ShelfService, db)
  ctx.plugin(ResourceRuntimeService, { db })
  ctx.plugin(PlayerService)
  await ctx.plugin(EdgeRouterService, db)
  await ctx.plugin(TimerService)
  await ctx.plugin(SchedulerService)
  await ctx.plugin(StorageService)
  for (const layer of seams.storageLayers ?? []) {
    ctx.storage.registerLayer(layer)
  }
  await ctx.plugin(ObservabilityService, {
    ...(seams.crashHooks === undefined ? {} : { crashHooks: seams.crashHooks }),
    ...(seams.sink === undefined ? {} : { sink: seams.sink }),
  })
  return db
}