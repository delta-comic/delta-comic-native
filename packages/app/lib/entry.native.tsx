import type { LoaderDatabase } from '@delta-comic/loader'
import type { ModuleEvaluator } from '@delta-comic/runtime'
import { Context } from 'cordis'
import type { Kysely } from 'kysely'
import { useEffect, useState } from 'react'
/**
 * RN 端入口（android/macos/windows 共用）：
 * 原生工程经 JSI 注入 globalThis.__DELTA_HOST__ 桥后注册根组件。
 */
import type {} from 'uniwind/types'
import { AppRegistry, Text, View } from 'react-native'

import { AppRoot } from './app-root.tsx'
import { createApp } from './bootstrap.ts'
import type { AppHandle, HostSeams } from './platform.ts'
import { createZipDirSource, type PackageFs } from './sources.ts'

/** 原生侧注入的宿主桥（Hermes/JSI 求值、SQLite、安装目录封装）。 */
export interface NativeHostBridge {
  readonly platform: 'android' | 'macos' | 'windows'
  createDb(): Promise<Kysely<LoaderDatabase>>
  readonly evaluator: ModuleEvaluator
  /** 官方插件安装目录内 zip 文件名列表与读取。 */
  listOfficialZips(): Promise<readonly string[]>
  readOfficialZip(name: string): Promise<Uint8Array>
}

declare global {
  // 由各端原生工程经 JSI 安装；缺失时入口渲染引导错误。
  var __DELTA_HOST__: NativeHostBridge | undefined
}

function MissingBridge() {
  return (
    <View className='flex-1 items-center justify-center bg-neutral-950'>
      <Text className='text-neutral-400'>原生宿主桥未注入（__DELTA_HOST__）</Text>
    </View>
  )
}

/** 启动门：装配完成后切换到导航壳。 */
function BootstrapGate(props: { readonly seams: HostSeams }) {
  const [app, setApp] = useState<AppHandle | null>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => {
    let alive = true
    createApp(new Context(), props.seams)
      .then(handle => {
        if (alive) setApp(handle)
      })
      .catch(cause => {
        if (alive) setError(cause)
      })
    return () => {
      alive = false
    }
  }, [props.seams])
  if (app !== null) return <AppRoot app={app} />
  if (error !== null) return <Text className='text-red-400'>{JSON.stringify(error)}</Text>
  return null
}

const bridge = globalThis.__DELTA_HOST__

if (bridge === undefined) {
  AppRegistry.registerComponent('DeltaComic', () => MissingBridge)
} else {
  const officialFs: PackageFs = {
    listZips: () => bridge.listOfficialZips(),
    readFile: name => bridge.readOfficialZip(name),
  }
  const seams: HostSeams = {
    platform: bridge.platform,
    createDb: () => bridge.createDb(),
    evaluator: bridge.evaluator,
    sources: [
      createZipDirSource({
        stage: 'official',
        dir: '',
        fs: officialFs,
        platform: bridge.platform,
        evaluator: bridge.evaluator,
        onError: (name, cause) => console.error(`插件包 ${name} 发现失败`, cause),
      }),
    ],
  }
  AppRegistry.registerComponent('DeltaComic', () => () => <BootstrapGate seams={seams} />)
}