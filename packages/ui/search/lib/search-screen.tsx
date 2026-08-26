import type { Item, ResourceRef } from '@delta-comic/protocol'
import type { SearchService } from '@delta-comic/search'
import { WaterfallCard } from '@delta-comic/ui-card'
import { Waterfall } from '@delta-comic/ui-waterfall'
/**
 * 搜索页：provider 单选 + 关键词输入 + 结果瀑布流（architecture.md §4 SearchPage）。
 *
 * - provider 投影来自 SearchService 注册表，单选后提交即检索
 * - 结果分页委托 provider cursor；空态/加载/失败可重试
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import type {} from 'uniwind/types'

export interface SearchScreenProps {
  readonly search: SearchService
  /** 进入页面时预填并立即执行的初始关键词。 */
  readonly initialQuery?: string
  readonly onOpenItem?: (item: Item) => void
  /** 将封面 ResourceRef 解析为可加载地址；缺省渲染占位底色。 */
  readonly resolvePreview?: (ref: ResourceRef) => string | null
}

export function SearchScreen({
  search,
  initialQuery,
  onOpenItem,
  resolvePreview,
}: SearchScreenProps) {
  const providers = useMemo(() => search.providers(), [search])
  const [providerId, setProviderId] = useState<string | undefined>(providers[0]?.id)
  const [draft, setDraft] = useState(initialQuery ?? '')
  const [run, setRun] = useState<{ query: string; token: number } | undefined>(() => {
    const trimmed = initialQuery?.trim()
    return trimmed !== undefined && trimmed.length > 0 ? { query: trimmed, token: 0 } : undefined
  })

  const submit = useCallback(() => {
    const query = draft.trim()
    if (query.length === 0) return
    setRun(previous => ({ query, token: previous?.query === query ? previous.token + 1 : 0 }))
  }, [draft])

  return (
    <View className='size-full bg-neutral-950'>
      <View className='flex-row items-center gap-2 p-3'>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder='搜索关键词'
          placeholderTextColor='#737373'
          returnKeyType='search'
          onSubmitEditing={submit}
          className='flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-100'
        />
        <Pressable onPress={submit} className='rounded-lg bg-sky-500 px-4 py-2 active:opacity-80'>
          <Text className='text-sm text-white'>搜索</Text>
        </Pressable>
      </View>
      {providers.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className='grow-0'>
          <View className='flex-row items-center gap-2 px-3 pb-2'>
            {providers.map(provider => (
              <Pressable
                key={provider.id}
                onPress={() => setProviderId(provider.id)}
                className={`rounded-full px-3.5 py-1.5 ${
                  providerId === provider.id ? 'bg-sky-500' : 'bg-neutral-800'
                }`}
              >
                <Text
                  className={`text-sm ${
                    providerId === provider.id ? 'text-white' : 'text-neutral-300'
                  }`}
                >
                  {provider.label ?? provider.id}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}
      {providers.length === 0 ? (
        <View className='flex-1 items-center justify-center'>
          <Text className='text-sm text-neutral-500'>暂无可用搜索源</Text>
        </View>
      ) : run === undefined ? (
        <View className='flex-1 items-center justify-center gap-1'>
          <Text className='text-base font-medium text-neutral-200'>开始搜索</Text>
          <Text className='text-sm text-neutral-500'>输入关键词后在所选搜索源中查找内容</Text>
        </View>
      ) : providerId === undefined ? (
        <View className='flex-1 items-center justify-center'>
          <Text className='text-sm text-neutral-500'>请选择搜索源</Text>
        </View>
      ) : (
        <SearchResultsView
          key={`${run.query}|${run.token}|${providerId}`}
          search={search}
          providerId={providerId}
          query={run.query}
          onOpenItem={onOpenItem}
          resolvePreview={resolvePreview}
        />
      )}
    </View>
  )
}

function SearchResultsView(props: {
  readonly search: SearchService
  readonly providerId: string
  readonly query: string
  readonly onOpenItem?: (item: Item) => void
  readonly resolvePreview?: (ref: ResourceRef) => string | null
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<readonly Item[]>([])
  const [hasMore, setHasMore] = useState(false)
  const cursorRef = useRef<string | undefined>(undefined)
  const loadingRef = useRef(false)
  const { width } = useWindowDimensions()
  const { search, providerId, query } = props

  const loadMore = useCallback(() => {
    if (loadingRef.current) return
    loadingRef.current = true
    void search.search(providerId, query, cursorRef.current).then(
      page => {
        cursorRef.current = page.cursor
        setHasMore(page.hasMore)
        setItems(previous => [...previous, ...page.items])
        setPhase('ready')
        loadingRef.current = false
      },
      () => {
        setPhase(previous => (previous === 'ready' ? 'ready' : 'error'))
        loadingRef.current = false
      },
    )
  }, [search, providerId, query, cursorRef, loadingRef])

  useEffect(() => {
    loadMore()
  }, [loadMore])

  const cards = items.map(item => (
    <WaterfallCard
      key={item.id}
      coverUri={item.preview === undefined ? null : (props.resolvePreview?.(item.preview) ?? null)}
      title={item.title}
      authorName={item.creatorRefs[0]?.displayName}
      viewCount={item.viewCount}
      onPress={() => props.onOpenItem?.(item)}
    />
  ))
  if (hasMore && phase === 'ready') {
    cards.push(
      <Pressable
        key='load-more'
        onPress={loadMore}
        className='items-center rounded-xl bg-neutral-900 py-4 active:opacity-80'
      >
        <Text className='text-sm text-neutral-400'>加载更多</Text>
      </Pressable>,
    )
  }

  if (phase === 'loading') {
    return (
      <View className='flex-1 items-center justify-center gap-2'>
        <ActivityIndicator />
        <Text className='text-sm text-neutral-400'>正在搜索</Text>
      </View>
    )
  }
  if (phase === 'error') {
    return (
      <View className='flex-1 items-center justify-center gap-3'>
        <Text className='text-base text-neutral-200'>搜索失败</Text>
        <Pressable
          onPress={loadMore}
          className='rounded-full bg-neutral-800 px-4 py-2 active:opacity-80'
        >
          <Text className='text-sm text-neutral-100'>重试</Text>
        </Pressable>
      </View>
    )
  }
  if (cards.length === 0) {
    return (
      <View className='flex-1 items-center justify-center'>
        <Text className='text-sm text-neutral-500'>没有找到相关内容</Text>
      </View>
    )
  }
  return (
    <View className='flex-1'>
      <Waterfall items={cards} width={width} />
    </View>
  )
}