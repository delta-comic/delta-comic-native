/** 定容环形缓冲：超限淘汰最旧条目，snapshot 返回写入顺序浅拷贝。 */
export class RingBuffer<T> {
  private readonly items: T[] = []

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`invalid ring capacity ${capacity}`)
    }
  }

  push(item: T): void {
    this.items.push(item)
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity)
    }
  }

  get size(): number {
    return this.items.length
  }

  snapshot(): T[] {
    return [...this.items]
  }
}