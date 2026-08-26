/** 浏览量缩写：<1万 原样，≥1万 以「万」一位小数，≥1亿 以「亿」一位小数。 */
export function formatViewCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) return '0'
  if (count < 10_000) return String(Math.floor(count))
  const [unit, scale] =
    count < 100_000_000 ? (['万', 10_000] as const) : (['亿', 100_000_000] as const)
  const value = count / scale
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  return `${text}${unit}`
}