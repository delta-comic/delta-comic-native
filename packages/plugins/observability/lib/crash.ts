/**
 * 崩溃捕获：宿主注入全局错误钩子（Node 用 process，RN 用全局错误处理器），
 * 崩溃现场写入 sink 并置 crashPending，下次启动由恢复界面读取提示。
 */

export type CrashHandler = (cause: unknown) => void

export interface CrashHooks {
  registerErrorHandler(handler: CrashHandler): void
  registerRejectionHandler(handler: CrashHandler): void
}

/** Node 默认钩子：uncaughtException 与 unhandledRejection。 */
export function nodeCrashHooks(target: Pick<NodeJS.Process, 'on'> = process): CrashHooks {
  return {
    registerErrorHandler(handler) {
      target.on('uncaughtException', cause => handler(cause))
    },
    registerRejectionHandler(handler) {
      target.on('unhandledRejection', cause => handler(cause))
    },
  }
}

export interface CrashCapture {
  /** 存在本会话崩溃记录时为真，供启动恢复界面提示。 */
  crashPending(): boolean
  lastCrash(): string | null
  detach(): void
}

export function attachCrashCapture(
  write: (line: string) => Promise<void> | void,
  hooks: CrashHooks,
): CrashCapture {
  let pending: string | null = null
  const describe = (label: string, cause: unknown): string => {
    const detail =
      cause instanceof Error ? `${cause.name}: ${cause.message}` : serializeCause(cause)
    return `[crash] ${label} ${detail}`
  }
  const onError = (cause: unknown): void => {
    pending = describe('error', cause)
    void Promise.resolve(write(pending)).catch(() => {})
  }
  hooks.registerErrorHandler(onError)
  hooks.registerRejectionHandler(cause => onError(cause))
  return {
    crashPending() {
      return pending !== null
    },
    lastCrash() {
      return pending
    },
    detach() {},
  }
}

function serializeCause(cause: unknown): string {
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch {
    return String(cause)
  }
}