/**
 * 关注页：分组 chips + 订阅卡网格 + 内嵌条目流（architecture.md §4）。
 *
 * - 分组行：全部 / 各分组 / 新建分组（内联输入）
 * - 订阅卡异步解析 SubscribableSummary，失败呈现占位态
 * - 点选订阅进入条目流；长按订阅取消订阅
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import type {} from 'uniwind/types'

import type {
  Item,
  ResourceRef,
  SubscribableProvider,
  SubscribableRef,
} from '@delta-comic/protocol'
import { WaterfallCard } from '@delta-comic/ui-card'
import { Waterfall } from '@delta-comic/ui-waterfall'
import type {
  SubscriptionEntity,
  SubscriptionGroupEntity,
  SubscribableRegistryService,
  SubscriptionService,
} from '@delta-comic/social'

export interface FollowScreenProps {
  readonly subscriptions: SubscriptionService
  readonly subscribables: SubscribableRegistryService
  readonly onOpenItem?: (item: Item) => void
  /** 将封面 ResourceRef 解析为可加载地址；缺省渲染占位底色。 */
  readonly resolvePreview?: (ref: ResourceRef) => string | null
}

interface FollowListing {
  readonly groups: readonly SubscriptionGroupEntity[]
  readonly listed: readonly SubscriptionEntity[]
}

export function FollowScreen({
  subscriptions,
  subscribables,
  onOpenItem,
  resolvePreview,
}: FollowScreenProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>()
  const [listing, setListing] = useState<FollowListing>()
  const [creating, setCreating] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [createError, setCreateError] = useState<string>()
  const [active, setActive] = useState<SubscribableRef>()
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      const groups = await subscriptions.listGroups()
      const listed = await subscriptions.listSubscriptions(selectedGroupId)
      if (live) setListing({ groups, listed })
    })()
    return () => {
      live = false
    }
  }, [subscriptions, selectedGroupId, reloadToken])

  const reload = useCallback(() => setReloadToken(token => token + 1), [])

  if (active !== undefined) {
    return (
      <SubscriptionItemsView
        target={active}
        provider={subscribables.provider(active.kind)}
        onBack={() => setActive(undefined)}
        onOpenItem={onOpenItem}
        resolvePreview={resolvePreview}
      />
    )
  }

  const createGroup = () => {
    void subscriptions.createGroup(draftTitle).then(
      () => {
        setDraftTitle('')
        setCreating(false)
        setCreateError(undefined)
        reload()
      },
      error => {
        setCreateError(error instanceof Error ? error.message : String(error))
      },
    )
  }

  return (
    <View className='size-full bg-neutral-950'>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className='grow-0'>
        <View className='flex-row items-center gap-2 px-3 py-2'>
          <Chip
            label='全部'
            active={selectedGroupId === undefined}
            onPress={() => setSelectedGroupId(undefined)}
          />
          {(listing?.groups ?? []).map(group => (
            <Chip
              key={group.id}
              label={group.title}
              active={selectedGroupId === group.id}
              onPress={() => setSelectedGroupId(group.id)}
            />
          ))}
          <Chip label='＋ 新建' active={creating} onPress={() => setCreating(value => !value)} />
        </View>
      </ScrollView>
      {creating && (
        <View className='flex-row items-center gap-2 px-3 pb-2'>
          <TextInput
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder='分组名称'
            placeholderTextColor='#737373'
            className='flex-1 rounded-lg bg-neutral-900 px-3 py-2 text-sm text-neutral-100'
          />
          <Pressable
            onPress={createGroup}
            className='rounded-lg bg-sky-500 px-3 py-2 active:opacity-80'
          >
            <Text className='text-sm text-white'>确定</Text>
          </Pressable>
        </View>
      )}
      {createError !== undefined && (
        <Text className='px-3 pb-1 text-xs text-red-400'>{createError}</Text>
      )}
      {listing === undefined ? (
        <View className='flex-1 items-center justify-center'>
          <ActivityIndicator />
        </View>
      ) : listing.listed.length === 0 ? (
        <View className='flex-1 items-center justify-center gap-1'>
          <Text className='text-base font-medium text-neutral-200'>暂无订阅</Text>
          <Text className='text-sm text-neutral-500'>在内容条目上订阅后即可在此查看</Text>
        </View>
      ) : (
        <ScrollView contentContainerClassName='flex-row flex-wrap gap-3 p-3'>
          {listing.listed.map(subscription => (
            <SubscriptionCard
              key={subscription.id}
              subscription={subscription}
              provider={subscribables.provider(subscription.targetKind)}
              resolvePreview={resolvePreview}
              onPress={() =>
                setActive({ kind: subscription.targetKind, id: subscription.targetId })
              }
              onUnsubscribe={() =>
                confirmUnsubscribe(subscriptions, subscription, reload)
              }
            />
          ))}
        </ScrollView>
      )}
    </View>
  )
}

function confirmUnsubscribe(
  subscriptions: SubscriptionService,
  subscription: SubscriptionEntity,
  done: () => void,
): void {
  Alert.alert('取消订阅', `不再关注「${subscription.targetId}」？`, [
    { text: '取消', style: 'cancel' },
    {
      text: '确认',
      style: 'destructive',
      onPress: () => {
        void subscriptions
          .unsubscribe(subscription.targetKind, subscription.targetId)
          .then(done)
      },
    },
  ])
}

function Chip(props: {
  readonly label: string
  readonly active: boolean
  readonly onPress: () => void
}) {
  return (
    <Pressable
      onPress={props.onPress}
      className={`rounded-full px-3.5 py-1.5 ${props.active ? 'bg-sky-500' : 'bg-neutral-800'}`}
    >
      <Text className={`text-sm ${props.active ? 'text-white' : 'text-neutral-300'}`}>
        {props.label}
      </Text>
    </Pressable>
  )
}

const CARD_WIDTH = 104

function SubscriptionCard(props: {
  readonly subscription: SubscriptionEntity
  readonly provider?: SubscribableProvider
  readonly resolvePreview?: (ref: ResourceRef) => string | null
  readonly onPress: () => void
  readonly onUnsubscribe: () => void
}) {
  const target = useMemo<SubscribableRef>(
    () => ({ kind: props.subscription.targetKind, id: props.subscription.targetId }),
    [props.subscription.targetKind, props.subscription.targetId],
  )
  const [attempt, setAttempt] = useState<
    | { readonly ok: true; readonly title: string; readonly coverUri: string | null }
    | { readonly ok: false }
    | undefined
  >()

  useEffect(() => {
    let live = true
    const provider = props.provider
    if (provider === undefined) {
      setAttempt({ ok: false })
      return undefined
    }
    provider.getSummary(target).then(
      summary => {
        if (live) {
          setAttempt({
            ok: true,
            title: summary.title,
            coverUri:
              summary.cover === undefined
                ? null
                : (props.resolvePreview?.(summary.cover) ?? null),
          })
        }
      },
      () => {
        if (live) setAttempt({ ok: false })
      },
    )
    return () => {
      live = false
    }
  }, [target])

  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onUnsubscribe}
      className='active:opacity-80'
      style={{ width: CARD_WIDTH }}
    >
      <View className='aspect-square w-full overflow-hidden rounded-xl bg-neutral-800'>
        {attempt?.ok === true && attempt.coverUri !== null && (
          <Image
            source={{ uri: attempt.coverUri }}
            className='size-full'
            style={{ resizeMode: 'cover' }}
          />
        )}
        {attempt === undefined && (
          <View className='size-full items-center justify-center'>
            <ActivityIndicator />
          </View>
        )}
        {attempt?.ok === false && (
          <View className='size-full items-center justify-center p-1'>
            <Text className='text-xs text-neutral-500'>无法获取</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={1} className='mt-1 text-xs text-neutral-200'>
        {attempt?.ok === true ? attempt.title : props.subscription.targetId}
      </Text>
    </Pressable>
  )
}

function SubscriptionItemsView(props: {
  readonly target: SubscribableRef
  readonly provider?: SubscribableProvider
  readonly onBack: () => void
  readonly onOpenItem?: (item: Item) => void
  readonly resolvePreview?: (ref: ResourceRef) => string | null
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<readonly Item[]>([])
  const [hasMore, setHasMore] = useState(false)
  const cursorRef = { current: undefined as string | undefined }
  const loadingRef = { current: false }
  const { width } = useWindowDimensions()

  const loadMore = useCallback(() => {
    if (loadingRef.current || props.provider === undefined) return
    loadingRef.current = true
    props.provider.getItems(props.target, cursorRef.current).then(
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
  }, [props.provider, props.target])

  useEffect(() => {
    loadMore()
  }, [loadMore])

  const cards = items.map(item => (
    <WaterfallCard
      key={item.id}
      coverUri={
        item.preview === undefined ? null : (props.resolvePreview?.(item.preview) ?? null)
      }
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

  return (
    <View className='size-full bg-neutral-950'>
      <Pressable onPress={props.onBack} className='self-start px-3 py-3 active:opacity-70'>
        <Text className='text-sm text-sky-400'>‹ 返回</Text>
      </Pressable>
      {phase === 'loading' ? (
        <View className='flex-1 items-center justify-center gap-2'>
          <ActivityIndicator />
          <Text className='text-sm text-neutral-400'>正在加载</Text>
        </View>
      ) : phase === 'error' ? (
        <View className='flex-1 items-center justify-center gap-3'>
          <Text className='text-base text-neutral-200'>加载失败</Text>
          <Pressable
            onPress={loadMore}
            className='rounded-full bg-neutral-800 px-4 py-2 active:opacity-80'
          >
            <Text className='text-sm text-neutral-100'>重试</Text>
          </Pressable>
        </View>
      ) : cards.length === 0 ? (
        <View className='flex-1 items-center justify-center'>
          <Text className='text-sm text-neutral-500'>暂无内容</Text>
        </View>
      ) : (
        <Waterfall items={cards} width={width} />
      )}
    </View>
  )
}
