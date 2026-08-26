/**
 * 四端共用根组件：loader 完成后渲染导航壳；
 * 失败插件恢复界面（RecoveryScreen）与播放器槽在后续接入。
 */
import { RootNavigator } from '@delta-comic/ui-shell'

import type { AppHandle } from './platform.ts'

export interface AppRootProps {
  readonly app: AppHandle
}

export function AppRoot(props: AppRootProps) {
  const ctx = props.app.ctx
  return (
    <RootNavigator
      ctx={{ routeRegistry: ctx.routeRegistry, navigation: ctx.navigation }}
      linkingPrefixes={['delta-comic://']}
    />
  )
}