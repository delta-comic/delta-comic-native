import type { FeedService } from '@delta-comic/feed'
import type { Item, ResourceRef } from '@delta-comic/protocol'
import { WaterfallCard } from '@delta-comic/ui-card'
import { Waterfall } from '@delta-comic/ui-waterfall'
/**
 * 首页：surface chips + FeedSession 聚合流水（architecture.md §4）。
 *
 * - 顶部横滑 chips 切换 FeedSurface，切换即重建会话并拉取首轮
 * - 内容流统一 Item -> WaterfallCard，点击经 onOpenItem 回调交由宿主路由
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native'
import type {} from 'uniwind/types'

export interface HomeScreenProps {
  readonly feed: FeedService
  readonly onOpenItem?: (item: Item) => void
  /** 将封面 ResourceRef 解析为可加载地址；缺省渲染占位底色。 */
  readonly resolvePreview?: (ref: ResourceRef) => string | null
}

export function HomeScreen({ feed, onOpenItem, resolvePreview }: HomeScreenProps) {
  const surfaces = useMemo(() => feed.surfaces(), [feed])
  const [surfaceId, setSurfaceId] = useState(() => surfaces[0]?.id)

  const session = useMemo(
    () => (surfaceId === undefined ? undefined : feed.createSession(surfaceId)),
    [feed, surfaceId],
  )
  const snapshot = useSyncExternalStore(
    session === undefined ? subscribeNoop : listener => session.subscribe(listener),
    session === undefined ? snapshotNoop : () => session.getSnapshot(),
  )

  useEffect(() => {
    if (session === undefined) return undefined
    void session.loadMore()
    return undefined
  }, [session])

  const { width } = useWindowDimensions()

  if (surfaces.length === 0) {
    return <CenterHint label='暂无内容源' hint='安装提供内容流的插件后即可浏览' />
  }
  if (session === undefined || snapshot === undefined) return null

  const cards = snapshot.entries.map(entry => (
    <WaterfallCard
      key={entry.item.id}
      coverUri={
        entry.item.preview === undefined ? null : (resolvePreview?.(entry.item.preview) ?? null)
      }
      title={entry.item.title}
      authorName={entry.item.creatorRefs[0]?.displayName}
      viewCount={entry.item.viewCount}
      onPress={() => onOpenItem?.(entry.item)}
    />
  ))
  const canLoadMore = snapshot.providers.some(
    provider => provider.hasMore && provider.status !== 'error',
  )
  if (snapshot.phase === 'ready' && canLoadMore) {
    cards.push(
      <Pressable
        key='load-more'
        onPress={() => void session.loadMore()}
        className='items-center rounded-xl bg-neutral-900 py-4 active:opacity-80'
      >
        <Text className='text-sm text-neutral-400'>加载更多</Text>
      </Pressable>,
    )
  }

  return (
    <View className='size-full bg-neutral-950'>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className='grow-0'>
        <View className='flex-row gap-2 px-3 py-2'>
          {surfaces.map(surface => {
            const active = surface.id === surfaceId
            return (
              <Pressable
                key={surface.id}
                onPress={() => setSurfaceId(surface.id)}
                className={`rounded-full px-3.5 py-1.5 ${active ? 'bg-sky-500' : 'bg-neutral-800'}`}
              >
                <Text className={`text-sm ${active ? 'text-white' : 'text-neutral-300'}`}>
                  {surface.title}
                </Text>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
      {(snapshot.phase === 'idle' || snapshot.phase === 'loading') &&
      snapshot.entries.length === 0 ? (
        <View className='flex-1 items-center justify-center gap-2'>
          <ActivityIndicator />
          <Text className='text-sm text-neutral-400'>正在加载</Text>
        </View>
      ) : snapshot.phase === 'error' ? (
        <View className='flex-1 items-center justify-center gap-3'>
          <Text className='text-base text-neutral-200'>加载失败</Text>
          <Pressable
            onPress={() => void session.refresh()}
            className='rounded-full bg-neutral-800 px-4 py-2 active:opacity-80'
          >
            <Text className='text-sm text-neutral-100'>重试</Text>
          </Pressable>
        </View>
      ) : snapshot.entries.length === 0 && snapshot.phase === 'ready' ? (
        <CenterHint label='暂无内容' hint='该内容源暂时没有可浏览的条目' />
      ) : (
        <Waterfall items={cards} width={width} />
      )}
    </View>
  )
}

function CenterHint({ label, hint }: { readonly label: string; readonly hint: string }) {
  return (
    <View className='flex-1 items-center justify-center gap-1'>
      <Text className='text-base font-medium text-neutral-200'>{label}</Text>
      <Text className='text-sm text-neutral-500'>{hint}</Text>
    </View>
  )
}

const subscribeNoop = () => () => {}
const snapshotNoop = () => undefined