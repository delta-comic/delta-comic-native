/**
 * 宿主装配锚点：Cordis root + 核心服务 + loader 启动。
 *
 * capability 授权时机：监听 'loader/plugin-state'，插件进入 verified
 * 即按 manifest.capabilities 授权（先于 activate，保证插件 apply 内可 assert）。
 */
import { validateManifest } from '@delta-comic/protocol'
import type { Context } from 'cordis'

import type { AppHandle, HostSeams } from './platform.ts'
import { mountCoreServices } from './services.ts'

export async function createApp(ctx: Context, seams: HostSeams): Promise<AppHandle> {
  const db = await mountCoreServices(ctx, seams)
  const stopGrant = wireCapabilityGrants(ctx)
  try {
    await ctx.pluginLoader.start({ sources: seams.sources, db })
  } catch (error) {
    stopGrant()
    throw error
  }
  return {
    ctx,
    dispose: async () => {
      stopGrant()
      await ctx.fiber.dispose()
      await db.destroy()
    },
  }
}

/** 状态机驱动授权：verified 授权，disabled/unavailable 撤销；中间态保持不变。 */
function wireCapabilityGrants(ctx: Context): () => void {
  const grants = new Map<string, () => void>()
  const disposer = ctx.on('loader/plugin-state', record => {
    const revoke = (): void => {
      const previous = grants.get(record.id)
      if (previous !== undefined) {
        previous()
        grants.delete(record.id)
      }
    }
    if (record.state === 'disabled' || record.state === 'unavailable') {
      revoke()
      return
    }
    if (grants.has(record.id)) return
    if (record.state !== 'verified') return
    const checked = validateManifest(ctx.pluginLoader.manifestOf(record.id))
    if (!checked.ok) return
    grants.set(record.id, ctx.capability.grant(record.id, checked.manifest.capabilities))
  })
  return () => {
    disposer()
    for (const revoke of grants.values()) revoke()
    grants.clear()
  }
}