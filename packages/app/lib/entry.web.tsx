import '@delta-comic/ui-theme/theme.css'
import './global.css'
import { Context } from 'cordis'
/**
 * Web 入口：装配宿主（内存 sql.js + runtime 目录来源）并挂载 DOM。
 */
import { createRoot } from 'react-dom/client'

import { AppRoot } from './app-root.tsx'
import { createApp } from './bootstrap.ts'
import type { HostSeams } from './platform.ts'
import { createZipDirSource } from './sources.ts'
import { createWebDb } from './web/db.ts'
import { createViteEsmEvaluator } from './web/evaluator.ts'
import { createWebPackageFs } from './web/source.ts'

const seams: HostSeams = {
  platform: 'web',
  createDb: createWebDb,
  evaluator: createViteEsmEvaluator(),
  sources: [
    createZipDirSource({
      stage: 'official',
      dir: 'runtime/',
      fs: createWebPackageFs(),
      platform: 'web',
      evaluator: createViteEsmEvaluator(),
      onError: (name, cause) => console.error(`插件包 ${name} 发现失败`, cause),
    }),
  ],
}

// Web 宿主开发期：__DEV__ 与调试桥配置全局，供 debug 插件（预构建工件）读取。
;(globalThis as Record<string, unknown>).__DEV__ = true
;(globalThis as Record<string, unknown>).__DELTA_DEV__ = {
  appId: 'web-device',
  platform: 'web',
  appVersion: '0.0.0-dev',
  // dcd 经 VITE_DELTA_DEV_MCP_URL 注入实际 ws 配对地址（含实时 token）
  mcpUrl: import.meta.env.VITE_DELTA_DEV_MCP_URL,
}

const root = createRoot(document.getElementById('root')!)
const ctx = new Context()

// Web 宿主开发期：把 logger 诊断转发到浏览器 console，便于观察 loader/discovery 错误。
ctx.logger.exporter({
  export(message: { type?: string; name?: string; args?: unknown[] }) {
    const type = typeof message.type === 'string' ? message.type : 'info'
    const fn = type === 'error' ? console.error : type === 'warn' ? console.warn : console.log
    fn(`[${type}] ${message.name ?? 'app'}`, ...(message.args ?? []))
  },
})
createApp(ctx, seams)
  .then(app => {
    root.render(<AppRoot app={app} />)
  })
  .catch(error => {
    console.error('宿主启动失败', error)
    root.render(<pre>{String(error)}</pre>)
  })