/**
 * 瀑布流卡片与条目动作菜单。
 *
 * - WaterfallCard：圆角封面 + 浏览量 overlay + 时长徽章 + 多行标题 + 作者行
 * - ItemActionMenu：底部弹层动作列表；props 与协议解耦，由调用方桥接 ItemAction
 */
import { Image } from 'expo-image'
import { Modal, Pressable, Text, View } from 'react-native'
import type {} from 'uniwind/types'

import { formatViewCount } from './format'

export interface WaterfallCardProps {
  /** 调用方解析 ResourceRef 后的封面地址；空值渲染占位底色。 */
  readonly coverUri: string | null
  readonly title: string
  readonly authorName?: string
  readonly authorAvatarUri?: string | null
  readonly viewCount?: number
  /** 右下角时长徽章文案（如 '12:30'）。 */
  readonly durationLabel?: string
  readonly onPress?: () => void
  /** ⋮ 按钮回调；缺省时隐藏按钮。 */
  readonly onMoreActions?: () => void
  className?: string
}

export function WaterfallCard({
  coverUri,
  title,
  authorName,
  authorAvatarUri,
  viewCount,
  durationLabel,
  onPress,
  onMoreActions,
  className,
}: WaterfallCardProps) {
  return (
    <View className={`overflow-hidden rounded-xl bg-neutral-900 ${className ?? ''}`}>
      <Pressable onPress={onPress} className='active:opacity-80'>
        <View className='aspect-[3/4] w-full bg-neutral-800'>
          {coverUri !== null && (
            <Image source={{ uri: coverUri }} className='size-full' contentFit='cover' />
          )}
          {viewCount !== undefined && (
            <View className='absolute bottom-1.5 left-1.5 flex-row items-center gap-0.5 rounded-full bg-black/60 px-2 py-0.5'>
              <Text className='text-[10px] text-white'>👁</Text>
              <Text className='text-[10px] text-white'>{formatViewCount(viewCount)}</Text>
            </View>
          )}
          {durationLabel !== undefined && (
            <View className='absolute right-1.5 bottom-1.5 rounded-md bg-black/70 px-1.5 py-0.5'>
              <Text className='text-[10px] text-white'>{durationLabel}</Text>
            </View>
          )}
        </View>
      </Pressable>
      <View className='gap-1 p-2'>
        <Text numberOfLines={2} className='text-sm leading-tight text-neutral-100'>
          {title}
        </Text>
        {(authorName !== undefined || onMoreActions !== undefined) && (
          <View className='flex-row items-center justify-between'>
            <View className='min-w-0 flex-1 flex-row items-center gap-1.5'>
              {authorAvatarUri != null ? (
                <Image
                  source={{ uri: authorAvatarUri }}
                  className='size-4 rounded-full'
                  contentFit='cover'
                />
              ) : (
                <View className='size-4 rounded-full bg-neutral-700' />
              )}
              {authorName !== undefined && (
                <Text numberOfLines={1} className='flex-1 text-xs text-neutral-400'>
                  {authorName}
                </Text>
              )}
            </View>
            {onMoreActions !== undefined && (
              <Pressable hitSlop={8} onPress={onMoreActions} className='px-1 active:opacity-60'>
                <Text className='text-sm text-neutral-400'>⋮</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  )
}

export interface ItemActionMenuEntry {
  readonly key: string
  readonly label: string
  readonly onSelect: () => void
}

export interface ItemActionMenuProps {
  readonly visible: boolean
  onClose: () => void
  readonly items: readonly ItemActionMenuEntry[]
}

/** 底部弹层动作菜单：按传入顺序列出条目，点选后收起。 */
export function ItemActionMenu({ visible, onClose, items }: ItemActionMenuProps) {
  return (
    <Modal visible={visible} transparent animationType='slide' onRequestClose={onClose}>
      <Pressable className='flex-1 justify-end bg-black/50' onPress={onClose}>
        <Pressable className='gap-1 rounded-t-2xl bg-neutral-900 px-2 pt-3 pb-8'>
          {items.map(item => (
            <Pressable
              key={item.key}
              className='rounded-lg px-4 py-3 active:bg-neutral-800'
              onPress={() => {
                onClose()
                item.onSelect()
              }}
            >
              <Text className='text-base text-neutral-100'>{item.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  )
}