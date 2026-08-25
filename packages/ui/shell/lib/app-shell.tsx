/**
 * AppShell 六区骨架：SystemChrome/TopBar/SecondaryNavigation/内容区(Waterfall)/
 * BottomNavigation/ModalHost 自上而下排布，各区内容由宿主注入。
 *
 * - SystemChrome 属平台层（状态栏/安全区），由宿主工程在入口处理，此处预留顶部安全边距
 * - SecondaryNavigation 为平板/宽屏侧栏，窄屏传 undefined 即收起
 */
import type { ReactNode } from 'react'
import { View } from 'react-native'

export interface AppShellProps {
  /** 顶栏（TopBar），含头像/搜索/扫码/公告。 */
  readonly topBar?: ReactNode
  /** 宽屏二级导航侧栏，窄屏省略。 */
  readonly secondaryNavigation?: ReactNode
  /** 主内容区，Phase 8 起接入 Waterfall。 */
  readonly content: ReactNode
  /** 底部五槽导航（BottomNavigation）。 */
  readonly bottomNavigation: ReactNode
  /** 顶层模态容器（ModalHost），PlayerHost 于 Phase 9 接入。 */
  readonly modalHost?: ReactNode
}

export function AppShell(props: AppShellProps) {
  return (
    <View className='flex-1 bg-neutral-950'>
      {props.topBar}
      <View className='flex-1 flex-row'>
        {props.secondaryNavigation}
        <View className='flex-1'>{props.content}</View>
      </View>
      {props.bottomNavigation}
      {props.modalHost}
    </View>
  )
}

/** ModalHost 占位容器：模态经 React Navigation fullScreenModal 承载，宿主可挂全局浮层。 */
export function ModalHost() {
  return null
}
