import type {
  HistoryEntry,
  HistoryService,
  ShelfEntry,
  ShelfKind,
  ShelfService,
} from '@delta-comic/library'
import type { ResourceRef } from '@delta-comic/protocol'
import type { DownloadService, DownloadSnapshot } from '@delta-comic/resource'
/**
 * 书架页：继续消费 / 最近打开 / 收藏 / 稍后 / 下载任务分区（architecture.md §4 书架）。
 *
 * - 历史经 partitionHistory 纯函数拆分，收藏/稍后来自 ShelfService
 * - 下载任务为可选投影（DownloadService 快照），变更经 subscribe 刷新
 * - 条目长按移除；点按回调 onOpenItem 携带 Item 快照
 */
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from 'react-native'
import type {} from 'uniwind/types'

import { partitionHistory } from './model'

export interface BookshelfScreenProps {
  readonly history: HistoryService
  readonly shelf: ShelfService
  /** 缺省隐藏下载任务分区。 */
  readonly downloads?: DownloadService
  readonly onOpenItem?: (item: NonNullable<HistoryEntry['item']>) => void
  /** 将封面 ResourceRef 解析为可加载地址；缺省渲染占位底色。 */
  readonly resolvePreview?: (ref: ResourceRef) => string | null
}

interface ShelfListing {
  readonly continuing: readonly HistoryEntry[]
  readonly recent: readonly HistoryEntry[]
  readonly favorites: readonly ShelfEntry[]
  readonly later: readonly ShelfEntry[]
  readonly downloads: readonly DownloadSnapshot[]
}

export function BookshelfScreen({
  history,
  shelf,
  downloads,
  onOpenItem,
  resolvePreview,
}: BookshelfScreenProps) {
  const [listing, setListing] = useState<ShelfListing>()
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let live = true
    void (async () => {
      const [entries, favorites, later] = await Promise.all([
        history.list(),
        shelf.list('favorite'),
        shelf.list('later'),
      ])
      const partitions = partitionHistory(entries)
      if (live) {
        setListing({
          continuing: partitions.continuing,
          recent: partitions.recent,
          favorites,
          later,
          downloads: downloads?.snapshots() ?? [],
        })
      }
    })()
    return () => {
      live = false
    }
  }, [history, shelf, downloads, reloadToken])

  useEffect(() => {
    if (downloads === undefined) return undefined
    return downloads.subscribe(() => setReloadToken(token => token + 1))
  }, [downloads])

  const reload = useCallback(() => setReloadToken(token => token + 1), [])

  const openEntry = (entry: HistoryEntry | ShelfEntry): void => {
    if (entry.item !== undefined) onOpenItem?.(entry.item)
  }

  if (listing === undefined) {
    return (
      <View className='size-full flex-1 items-center justify-center bg-neutral-950'>
        <ActivityIndicator />
      </View>
    )
  }

  const isEmpty =
    listing.continuing.length === 0 &&
    listing.recent.length === 0 &&
    listing.favorites.length === 0 &&
    listing.later.length === 0 &&
    listing.downloads.length === 0

  return (
    <ScrollView className='size-full bg-neutral-950' contentContainerClassName='gap-4 p-3 pb-8'>
      {isEmpty && (
        <View className='items-center gap-1 py-16'>
          <Text className='text-base font-medium text-neutral-200'>书架还是空的</Text>
          <Text className='text-sm text-neutral-500'>打开或收藏内容后会出现在这里</Text>
        </View>
      )}
      {listing.continuing.length > 0 && (
        <EntrySection
          title='继续消费'
          entries={listing.continuing}
          resolvePreview={resolvePreview}
          onPress={entry => openEntry(entry)}
          onRemove={entry =>
            confirmRemove('移除历史', `不再保留「${entry.title}」的进度？`, () => {
              void history.remove(entry.itemId).then(reload)
            })
          }
        />
      )}
      {listing.recent.length > 0 && (
        <EntrySection
          title='最近打开'
          entries={listing.recent}
          resolvePreview={resolvePreview}
          onPress={entry => openEntry(entry)}
          onRemove={entry =>
            confirmRemove('移除历史', `不再保留「${entry.title}」的打开记录？`, () => {
              void history.remove(entry.itemId).then(reload)
            })
          }
        />
      )}
      {listing.favorites.length > 0 && (
        <EntrySection
          title='收藏'
          entries={listing.favorites}
          resolvePreview={resolvePreview}
          onPress={entry => openEntry(entry)}
          onRemove={entry =>
            confirmRemove('移除收藏', `将「${entry.title}」移出收藏？`, () => {
              void shelf.remove('favorite' satisfies ShelfKind, entry.itemId).then(reload)
            })
          }
        />
      )}
      {listing.later.length > 0 && (
        <EntrySection
          title='稍后再看'
          entries={listing.later}
          resolvePreview={resolvePreview}
          onPress={entry => openEntry(entry)}
          onRemove={entry =>
            confirmRemove('移除稍后再看', `将「${entry.title}」移出稍后再看？`, () => {
              void shelf.remove('later' satisfies ShelfKind, entry.itemId).then(reload)
            })
          }
        />
      )}
      {listing.downloads.length > 0 && <DownloadSection snapshots={listing.downloads} />}
    </ScrollView>
  )
}

function confirmRemove(title: string, message: string, done: () => void): void {
  Alert.alert(title, message, [
    { text: '取消', style: 'cancel' },
    { text: '确认', style: 'destructive', onPress: done },
  ])
}

function EntrySection(props: {
  readonly title: string
  readonly entries: readonly (HistoryEntry | ShelfEntry)[]
  readonly resolvePreview?: (ref: ResourceRef) => string | null
  readonly onPress: (entry: HistoryEntry | ShelfEntry) => void
  readonly onRemove: (entry: HistoryEntry | ShelfEntry) => void
}) {
  return (
    <View className='gap-2'>
      <Text className='text-sm font-semibold text-neutral-300'>{props.title}</Text>
      {props.entries.map(entry => {
        const scope = 'kind' in entry ? entry.kind : 'history'
        return (
          <EntryRow
            key={`${scope}/${entry.itemId}`}
            entry={entry}
            resolvePreview={props.resolvePreview}
            onPress={() => props.onPress(entry)}
            onRemove={() => props.onRemove(entry)}
          />
        )
      })}
    </View>
  )
}

function EntryRow(props: {
  readonly entry: HistoryEntry | ShelfEntry
  readonly resolvePreview?: (ref: ResourceRef) => string | null
  readonly onPress: () => void
  readonly onRemove: () => void
}) {
  const { entry } = props
  const coverUri =
    entry.item?.preview === undefined ? null : (props.resolvePreview?.(entry.item.preview) ?? null)
  const ratio = 'progressRatio' in entry ? entry.progressRatio : undefined
  const openedCount = 'openedCount' in entry ? entry.openedCount : 1
  const meta =
    ratio === undefined
      ? `已打开 ${openedCount} 次`
      : `进度 ${Math.round(ratio * 100)}% · 已打开 ${openedCount} 次`
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onRemove}
      className='flex-row items-center gap-3 rounded-xl bg-neutral-900 p-2 active:opacity-80'
    >
      <View className='size-14 overflow-hidden rounded-lg bg-neutral-800'>
        {coverUri !== null && (
          <Image source={{ uri: coverUri }} className='size-full' style={{ resizeMode: 'cover' }} />
        )}
      </View>
      <View className='flex-1 gap-0.5'>
        <Text numberOfLines={1} className='text-sm text-neutral-100'>
          {entry.title}
        </Text>
        <Text numberOfLines={1} className='text-xs text-neutral-500'>
          {meta}
        </Text>
      </View>
      {ratio !== undefined && (
        <View className='h-1 w-16 overflow-hidden rounded-full bg-neutral-800'>
          <View className='h-full bg-sky-500' style={{ width: `${Math.round(ratio * 100)}%` }} />
        </View>
      )}
    </Pressable>
  )
}

const STATUS_LABELS: Readonly<Record<DownloadSnapshot['status'], string>> = {
  queued: '排队中',
  running: '下载中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function DownloadSection(props: { readonly snapshots: readonly DownloadSnapshot[] }) {
  return (
    <View className='gap-2'>
      <Text className='text-sm font-semibold text-neutral-300'>下载任务</Text>
      {props.snapshots.map(snapshot => (
        <View
          key={snapshot.id}
          className='flex-row items-center gap-3 rounded-xl bg-neutral-900 p-2'
        >
          <View className='flex-1 gap-0.5'>
            <Text numberOfLines={1} className='text-sm text-neutral-100'>
              {snapshot.ref}
            </Text>
            <Text numberOfLines={1} className='text-xs text-neutral-500'>
              {STATUS_LABELS[snapshot.status]} · {formatBytes(snapshot.receivedBytes)}
              {snapshot.totalBytes === undefined ? '' : ` / ${formatBytes(snapshot.totalBytes)}`}
            </Text>
          </View>
          {snapshot.error !== undefined && (
            <Text numberOfLines={1} className='max-w-24 text-xs text-red-400'>
              {snapshot.error}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}