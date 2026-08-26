import { Context } from 'cordis'

import { StorageService } from '../lib/service'
import type { StorageKind } from '../lib/service'

export interface MemoryLayer {
  adapter: {
    readonly id: string
    readonly kind: StorageKind
    list(): Promise<StorageObjectLite[]>
    remove(key: string): Promise<void>
  }
  put(key: string, sizeBytes: number, lastAccessAt?: number): void
  has(key: string): boolean
}

interface StorageObjectLite {
  key: string
  sizeBytes: number
  lastAccessAt: number
}

export function createMemoryLayer(id: string, kind: StorageKind): MemoryLayer {
  const objects = new Map<string, StorageObjectLite>()
  return {
    adapter: {
      id,
      kind,
      list: async () => [...objects.values()],
      remove: async key => {
        objects.delete(key)
      },
    },
    put(key, sizeBytes, lastAccessAt = 0) {
      objects.set(key, { key, sizeBytes, lastAccessAt })
    },
    has(key) {
      return objects.has(key)
    },
  }
}

export interface StorageHarness {
  ctx: Context
  service: StorageService
}

export async function createStorage(
  config?: ConstructorParameters<typeof StorageService>[1],
): Promise<StorageHarness> {
  const ctx = new Context()
  await ctx.plugin(StorageService, config)
  return { ctx, service: ctx.storage }
}