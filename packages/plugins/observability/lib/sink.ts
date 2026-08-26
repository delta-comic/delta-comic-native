/**
 * 日志落盘抽象：桌面/Android 用滚动文件，Web 用内存环形。
 * 平台文件适配器由宿主注入（Phase 13），核心只定义协议与滚动策略。
 */
export interface LogSink {
  append(line: string): Promise<void>
}

/** 平台文件适配器：appendFile 追加文本；rotate 将当前文件轮转为归档名。 */
export interface FileAdapter {
  appendFile(path: string, text: string): Promise<void>
  rotate(path: string, archivePath: string): Promise<void>
}

export function createMemorySink(capacity = 1000): LogSink & { lines(): string[] } {
  const lines: string[] = []
  return {
    async append(line) {
      lines.push(line)
      if (lines.length > capacity) lines.splice(0, lines.length - capacity)
    },
    lines() {
      return [...lines]
    },
  }
}

export interface RollingSinkOptions {
  /** 当前日志文件路径（平台相对键，非绝对路径）。 */
  readonly path: string
  /** 单文件字节上限，超出触发轮转；默认 1 MiB。 */
  readonly maxBytes?: number
  /** 保留归档份数上限，超出删除最旧；adapter 未实现 remove 时忽略。 */
  readonly maxArchives?: number
}

export function createRollingSink(
  adapter: FileAdapter & { remove?(path: string): Promise<void> },
  options: RollingSinkOptions,
): LogSink {
  const maxBytes = options.maxBytes ?? 1024 * 1024
  let written = 0
  let rotation = 0
  const archives: string[] = []
  return {
    async append(line) {
      if (written >= maxBytes) {
        const archivePath = `${options.path}.${rotation++}`
        await adapter.rotate(options.path, archivePath)
        archives.push(archivePath)
        written = 0
        if (adapter.remove !== undefined && options.maxArchives !== undefined) {
          while (archives.length > options.maxArchives) {
            const oldest = archives.shift()
            if (oldest !== undefined) await adapter.remove(oldest).catch(() => {})
          }
        }
      }
      await adapter.appendFile(options.path, `${line}\n`)
      written += line.length + 1
    },
  }
}