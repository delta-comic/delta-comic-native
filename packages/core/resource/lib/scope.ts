/**
 * ResourceScope：资源租约与清理回调的生命周期容器。
 *
 * - PlayerInstance 创建时配套 scope，宿主卸载时 close
 * - lease 释放幂等；close 按 LIFO 执行 onClose 回调，整体幂等
 */
export interface ResourceLease {
  release(): void
}

export class ResourceScope {
  private readonly leases = new Set<ResourceLease>()
  private readonly callbacks: Array<() => void | Promise<void>> = []
  #closed = false

  get closed(): boolean {
    return this.#closed
  }

  /** 登记一个资源租约，scope 关闭时自动释放。 */
  acquire(label: string): ResourceLease {
    if (this.#closed) throw new Error(`ResourceScope 已关闭，无法登记租约：${label}`)
    let released = false
    const lease: ResourceLease = {
      release: () => {
        if (released) return
        released = true
        this.leases.delete(lease)
      },
    }
    this.leases.add(lease)
    return lease
  }

  /** 注册关闭回调，close 时按注册逆序执行。 */
  onClose(callback: () => void | Promise<void>): void {
    if (this.#closed) throw new Error('ResourceScope 已关闭，无法注册回调')
    this.callbacks.push(callback)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    for (const lease of [...this.leases]) lease.release()
    for (const callback of [...this.callbacks].reverse()) await callback()
    this.callbacks.length = 0
  }
}
