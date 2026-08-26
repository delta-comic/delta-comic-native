/** 瀑布流断点：compact 2 列 / medium 3 列 / expanded 4 列。 */
export const WATERFALL_BREAKPOINTS = { medium: 768, expanded: 1280 } as const

/** 按容器宽度返回列数：<768 → 2，<1280 → 3，其余 → 4。 */
export function columnsForWidth(width: number): number {
  if (width < WATERFALL_BREAKPOINTS.medium) return 2
  if (width < WATERFALL_BREAKPOINTS.expanded) return 3
  return 4
}