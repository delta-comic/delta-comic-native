import { createEsmEvaluator } from '@delta-comic/runtime'
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
import { createWebPackageFs } from './web/source.ts'

const seams: HostSeams = {
  platform: 'web',
  createDb: createWebDb,
  evaluator: createEsmEvaluator(),
  sources: [
    createZipDirSource({
      stage: 'official',
      dir: 'runtime/',
      fs: createWebPackageFs(),
      platform: 'web',
      evaluator: createEsmEvaluator(),
      onError: (name, cause) => console.error(`插件包 ${name} 发现失败`, cause),
    }),
  ],
}

const root = createRoot(document.getElementById('root')!)
createApp(new Context(), seams)
  .then(app => root.render(<AppRoot app={app} />))
  .catch(error => {
    console.error('宿主启动失败', error)
    root.render(<pre>{String(error)}</pre>)
  })