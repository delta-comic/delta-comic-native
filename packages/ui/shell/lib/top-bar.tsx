/**
 * TopBar：圆形头像 + 胶囊搜索框 + 扫码 + 公告入口（设计语言 §顶栏）。
 *
 * - 搜索框为按压胶囊，点击后由宿主导航至 core/search
 * - 公告为可选条目，无公告时隐藏
 */
import { Image, Pressable, Text, View } from 'react-native'

export interface TopBarProps {
  /** 头像图源 URI；缺省渲染占位圆。 */
  readonly avatarUri?: string
  readonly onAvatarPress: () => void
  readonly searchPlaceholder: string
  readonly onSearchPress: () => void
  readonly onScanPress: () => void
  readonly announcement?: string
  readonly onAnnouncementPress?: () => void
}

export function TopBar(props: TopBarProps) {
  return (
    <View className='gap-3 bg-neutral-950 px-4 pt-3 pb-2'>
      <View className='flex-row items-center gap-3'>
        <Pressable onPress={props.onAvatarPress} className='active:opacity-70'>
          {props.avatarUri === undefined ? (
            <View className='size-9 rounded-full bg-neutral-800' />
          ) : (
            <Image source={{ uri: props.avatarUri }} className='size-9 rounded-full' />
          )}
        </Pressable>
        <Pressable
          onPress={props.onSearchPress}
          className='h-9 flex-1 flex-row items-center rounded-full bg-neutral-900 px-4 active:bg-neutral-800'
        >
          <Text className='text-sm text-neutral-500'>{props.searchPlaceholder}</Text>
        </Pressable>
        <Pressable onPress={props.onScanPress} className='px-1 active:opacity-70'>
          <Text className='text-lg text-neutral-200'>⌗</Text>
        </Pressable>
      </View>
      {props.announcement !== undefined ? (
        <AnnouncementRow text={props.announcement} onPress={props.onAnnouncementPress} />
      ) : null}
    </View>
  )
}

function AnnouncementRow(props: { readonly text: string; readonly onPress?: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.onPress === undefined}
      className='flex-row items-center gap-2 rounded-xl bg-pink-500/10 px-3 py-2 active:bg-pink-500/20'
    >
      <Text className='font-medium text-pink-400'>公告</Text>
      <Text className='flex-1 text-xs text-neutral-300' numberOfLines={1}>
        {props.text}
      </Text>
    </Pressable>
  )
}