import { dbPackageVersion } from '@delta-comic/db'
import { protocolVersion } from '@delta-comic/protocol'
import { UIRegistryService } from '@delta-comic/registry'
import { describe, expect, it } from 'vitest'

import { PluginLoaderService, PLUGIN_STAGES } from '../lib/index'

describe('loader 包骨架', () => {
  it('依赖的核心包均可解析', async () => {
    expect(typeof PluginLoaderService).toBe('function')
    expect(typeof UIRegistryService).toBe('function')
    expect(dbPackageVersion).toBe(protocolVersion)
    expect(PLUGIN_STAGES).toEqual(['verify', 'migrate', 'activate', 'rollback'])
  })
})