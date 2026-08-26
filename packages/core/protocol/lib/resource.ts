/**
 * 资源协议（architecture.md §5）。
 *
 * - ResourceRef 为最小引用形态，provider 按 kind 唯一注册
 * - resolve 将 ref 归一化为 ResourceDescriptor（尺寸/校验和/MIME 可选）
 * - open 返回字节流 AsyncIterable，支持 signal 中断与 offset 续传起点
 */
import type { ResourceRef } from './feed.ts'

/** 归一化资源描述：在 ResourceRef 之上补充元信息，全部字段可选由 provider 自决。 */
export interface ResourceDescriptor extends ResourceRef {
  readonly size?: number
  readonly checksum?: ResourceChecksum
  readonly mime?: string
}

export interface ResourceChecksum {
  readonly algorithm: string
  readonly digest: string
}

export interface ResourceOpenOptions {
  readonly signal?: AbortSignal
  /** 起始字节偏移，用于断点续传；provider 不支持时应抛 RangeUnsupportedError。 */
  readonly offset?: number
}

export class RangeUnsupportedError extends Error {
  constructor() {
    super('资源 provider 不支持范围请求')
    this.name = 'RangeUnsupportedError'
  }
}

/** 资源提供者：按 kind 全局唯一。 */
export interface ResourceProvider {
  readonly id: string
  readonly kind: string
  resolve(ref: ResourceRef): Promise<ResourceDescriptor>
  open(descriptor: ResourceDescriptor, options?: ResourceOpenOptions): AsyncIterable<Uint8Array>
}