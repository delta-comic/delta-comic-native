import type { HistoryEntry } from '@delta-comic/library'

/**
 * 书架历史分区（architecture.md §4 书架）：
 *
 * - continuing：携带归一化进度（progressRatio）的历史，按 last_opened_at 倒序承接「继续消费」
 * - recent：全部最近打开历史，服务层已按 last_opened_at 倒序返回
 */
export interface HistoryPartitions {
  readonly continuing: readonly HistoryEntry[]
  readonly recent: readonly HistoryEntry[]
}

export function partitionHistory(entries: readonly HistoryEntry[]): HistoryPartitions {
  const continuing = entries.filter(entry => entry.progressRatio !== undefined)
  return { continuing, recent: entries }
}