import { readLedger } from '@delta-comic/db'
import type { CoreDatabase, MigrationLedgerDatabase } from '@delta-comic/db'
import type { Kysely } from 'kysely'

import type { LogCapture } from './capture'

/** 宿主可选依赖注入：由 Phase 13 各端宿主按平台装配。 */
export interface DiagnosticsProviders {
  /** 插件状态机快照（loader diagnostics）。 */
  readonly plugins?: () => readonly unknown[]
  /** 审计日志读取（capability.recentAudit）。 */
  readonly audit?: (limit: number) => Promise<unknown[]>
}

export type DiagnosticsDb = Kysely<MigrationLedgerDatabase & CoreDatabase>

export interface DiagnosticBundle {
  readonly exportedAt: string
  readonly platform: string
  readonly logs: string[]
  readonly plugins: readonly unknown[]
  readonly ledger: readonly unknown[]
  readonly audit: readonly unknown[]
}

/** 汇集诊断包：最近日志 + 插件状态机快照 + migration ledger + 审计日志。 */
export async function exportDiagnostics(
  capture: LogCapture,
  options: {
    platform?: string
    logLimit?: number
    auditLimit?: number
    db?: DiagnosticsDb
    providers?: DiagnosticsProviders
  } = {},
): Promise<DiagnosticBundle> {
  const plugins = options.providers?.plugins?.() ?? []
  const audit = (await options.providers?.audit?.(options.auditLimit ?? 100)) ?? []
  const ledger = options.db === undefined ? [] : await readLedger(options.db)
  return {
    exportedAt: new Date().toISOString(),
    platform: options.platform ?? 'unknown',
    logs: capture
      .format(options.logLimit ?? 200)
      .split('\n')
      .filter(line => line.length > 0),
    plugins,
    ledger,
    audit,
  }
}