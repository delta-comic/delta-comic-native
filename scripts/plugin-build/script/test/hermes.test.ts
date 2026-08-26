import { describe, expect, it, vi } from 'vitest'

import { emitBytecode } from '../../src/hermes.ts'

describe('emitBytecode', () => {
  it('以 hermesc -emit-binary 调用注入的执行器', () => {
    const run = vi.fn<(file: string, args: readonly string[]) => void>()
    emitBytecode({ hermesc: '/tools/hermesc', input: 'in.js', output: 'out.hbc' }, run)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith('/tools/hermesc', ['-emit-binary', '-out', 'out.hbc', 'in.js'])
  })
})