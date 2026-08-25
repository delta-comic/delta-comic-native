/**
 * BottomNavigation：四常规槽 + 中央凸起粉色 FAB（设计语言 §底部导航）。
 *
 * - 槽位顺序：首页/关注/[FAB=添加]/书架/我的
 * - FAB 为 PrimaryAction，目标可由插件经路由注册表提供
 * - 图标体系待接入后补充，当前以文本标签呈现
 */
import { Pressable, Text, View } from 'react-native'

export interface BottomTabItem {
  /** 路由 key，如 'core/home'。 */
  readonly key: string
  readonly label: string
}

export interface BottomNavigationProps {
  /** 左右四个常规槽（按显示顺序）。 */
  readonly tabs: readonly BottomTabItem[]
  readonly activeKey: string
  readonly onTabPress: (key: string) => void
  readonly primaryActionLabel: string
  readonly onPrimaryActionPress: () => void
}

export function BottomNavigation(props: BottomNavigationProps) {
  if (props.tabs.length !== 4) {
    throw new Error(`BottomNavigation 固定四常规槽，收到 ${props.tabs.length} 个`)
  }
  return (
    <View className='flex-row items-center border-t border-neutral-800 bg-neutral-900 px-2 pb-2 pt-1'>
      <TabSlot item={props.tabs[0]} active={props.activeKey === props.tabs[0].key} onPress={props.onTabPress} />
      <TabSlot item={props.tabs[1]} active={props.activeKey === props.tabs[1].key} onPress={props.onTabPress} />
      <PrimaryAction
        label={props.primaryActionLabel}
        onPress={props.onPrimaryActionPress}
      />
      <TabSlot item={props.tabs[2]} active={props.activeKey === props.tabs[2].key} onPress={props.onTabPress} />
      <TabSlot item={props.tabs[3]} active={props.activeKey === props.tabs[3].key} onPress={props.onTabPress} />
    </View>
  )
}

function TabSlot(props: {
  readonly item: BottomTabItem
  readonly active: boolean
  readonly onPress: (key: string) => void
}) {
  return (
    <Pressable
      onPress={() => props.onPress(props.item.key)}
      className='flex-1 items-center gap-0.5 py-1 active:opacity-60'
    >
      <Text className={props.active ? 'text-sm font-semibold text-pink-400' : 'text-sm text-neutral-500'}>
        {props.item.label}
      </Text>
    </Pressable>
  )
}

function PrimaryAction(props: { readonly label: string; readonly onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} className='flex-1 items-center active:opacity-80'>
      <View className='-mt-6 size-12 items-center justify-center rounded-full bg-pink-500 shadow-lg shadow-pink-500/40'>
        <Text className='text-2xl font-bold leading-9 text-white'>+</Text>
      </View>
      <Text className='text-xs text-neutral-400'>{props.label}</Text>
    </Pressable>
  )
}
