/**
 * 调试载荷安全序列化。
 *
 * 日志参数与事件参数可能包含 bigint、循环引用、Error 或深层对象，
 * 直接 JSON.stringify 会抛错或爆栈；此处产出受限深度的纯 JSON 值。
 */
const MAX_DEPTH = 4
const MAX_ARRAY_ITEMS = 50
const MAX_OBJECT_KEYS = 50

export function safeSerialize(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (typeof value === 'symbol') return value.toString()
    return value
  }
  if (seen.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[Depth]'
  seen.add(value)
  try {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack }
    }
    if (Array.isArray(value)) {
      const items = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map(item => safeSerialize(item, depth + 1, seen))
      return value.length > MAX_ARRAY_ITEMS
        ? [...items, `[+${value.length - MAX_ARRAY_ITEMS}]`]
        : items
    }
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS)
    const result: Record<string, unknown> = {}
    for (const [key, item] of entries) result[key] = safeSerialize(item, depth + 1, seen)
    return result
  } finally {
    seen.delete(value)
  }
}