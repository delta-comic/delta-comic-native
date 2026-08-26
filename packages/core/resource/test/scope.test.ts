import { describe, expect, it, vi } from 'vitest'

import { ResourceScope } from '../lib/scope'

describe('ResourceScope', () => {
  it('close 按 LIFO 执行回调且幂等', async () => {
    const scope = new ResourceScope()
    const order: string[] = []
    scope.onClose(() => {
      order.push('a')
    })
    scope.onClose(() => {
      order.push('b')
    })
    const lease = scope.acquire('lease')
    await scope.close()
    await scope.close()
    expect(order).toEqual(['b', 'a'])
    expect(scope.closed).toBe(true)
    expect(() => lease.release()).not.toThrow()
  })

  it('关闭后 acquire 与 onClose 抛错', async () => {
    const scope = new ResourceScope()
    scope.onClose(() => {})
    await scope.close()
    expect(() => scope.acquire('x')).toThrow(/已关闭/)
    expect(() => scope.onClose(() => {})).toThrow(/已关闭/)
  })

  it('acquire 的租约 release 幂等且 close 只释放未释放租约', async () => {
    const scope = new ResourceScope()
    const first = scope.acquire('first')
    scope.acquire('second')
    first.release()
    first.release()
    const spy = vi.fn()
    scope.onClose(spy)
    await scope.close()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
