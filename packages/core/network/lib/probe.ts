/**
 * 端点探测原语：并发轻量 GET 竞速（architecture.md §8.2）。
 *
 * - Promise.any 语义：任一候选首个成功即兑现 whenFirst，selected 立即产生
 * - 全部候选出结果后 whenSettled 给出按 latency 升序的成功排名（HEAD 已弃用）
 * - 默认实现走全局 fetch（Node/Web/RN 通用），超时以 AbortController 实现
 */
import type { Edge } from '@delta-comic/protocol'

/** 单个候选的探测成功记录。 */
export interface RankedEndpoint {
  readonly edge: Edge
  readonly latencyMs: number
}

export interface ProbeOptions {
  readonly timeoutMs: number
}

/** 竞速结果：whenFirst 首胜即决；whenSettled 全量排名。 */
export interface ProbeRace {
  readonly whenFirst: Promise<RankedEndpoint>
  readonly whenSettled: Promise<readonly RankedEndpoint[]>
}

export type Prober = (edges: readonly Edge[], options: ProbeOptions) => ProbeRace

function probeOnce(edge: Edge, timeoutMs: number, doFetch: typeof fetch): Promise<RankedEndpoint> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const startedAt = Date.now()
    const timer = setTimeout(() => {
      controller.abort()
      reject(new Error(`端点探测超时：${edge.baseUrl}`))
    }, timeoutMs)
    doFetch(edge.baseUrl, { method: 'GET', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`端点探测 HTTP ${response.status}：${edge.baseUrl}`)
        void response.body?.cancel()
        clearTimeout(timer)
        resolve({ edge, latencyMs: Date.now() - startedAt })
      })
      .catch((cause: unknown) => {
        clearTimeout(timer)
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      })
  })
}

/** 默认 HTTP 探测器；doFetch 可注入以便测试与平台适配。 */
export function createHttpProber(doFetch: typeof fetch = fetch): Prober {
  return (edges, options) => {
    const attempts = edges.map(edge => probeOnce(edge, options.timeoutMs, doFetch))
    return {
      whenFirst: Promise.any(attempts),
      whenSettled: Promise.allSettled(attempts).then(results =>
        results
          .flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
          .sort((a, b) => a.latencyMs - b.latencyMs),
      ),
    }
  }
}
