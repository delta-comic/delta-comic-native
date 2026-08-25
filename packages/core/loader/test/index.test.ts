import { dbPackageVersion } from '@delta-comic/db'
import { protocolVersion } from '@delta-comic/protocol'
import { UIRegistryService } from '@delta-comic/registry'
import { describe, expect, it } from 'vitest'

import { apply } from '../lib/index'

describe('loader 包骨架', () => {
  it('依赖的核心包均可解析', async () => {
    expect(typeof apply).toBe('function')
    expect(typeof UIRegistryService).toBe('function')
    expect(dbPackageVersion).toBe(protocolVersion)
  })
})