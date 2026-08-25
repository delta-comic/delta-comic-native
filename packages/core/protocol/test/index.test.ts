import { describe, expect, it } from 'vitest'

import { protocolVersion } from '../lib/index'

describe('protocol 包骨架', () => {
  it('协议版本与宿主 semver 一致', () => {
    expect(protocolVersion).toBe('1.0.0')
  })
})