import type { PluginRecord } from '@delta-comic/loader'
import type { PluginLoaderService } from '@delta-comic/loader'
/**
 * 我的页：设置入口 / 插件管理状态投影 / 缓存与诊断占位 / 版本信息（architecture.md §4 我的）。
 *
 * - 行组点击回调由宿主注入；缺省时行仍可渲染但点击无动作
 * - 插件列表来自 PluginLoaderService.diagnostics() 快照，badge 呈现运行态
 */
import { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type {} from 'uniwind/types'

export interface MineScreenProps {
  readonly appVersion?: string
  /** 缺省隐藏插件管理分区。 */
  readonly loader?: PluginLoaderService
  readonly onOpenSettings?: () => void
  readonly onOpenCache?: () => void
  readonly onOpenDiagnostics?: () => void
}

const STATE_LABELS: Readonly<Record<PluginRecord['state'], string>> = {
  discovered: '已发现',
  verified: '已校验',
  migrating: '迁移中',
  migrated: '已迁移',
  activating: '激活中',
  active: '运行中',
  disabled: '已停用',
  unavailable: '不可用',
}

const STATE_BADGES: Readonly<Record<PluginRecord['state'], string>> = {
  discovered: 'bg-neutral-700 text-neutral-200',
  verified: 'bg-neutral-700 text-neutral-200',
  migrating: 'bg-sky-900 text-sky-300',
  migrated: 'bg-sky-900 text-sky-300',
  activating: 'bg-sky-900 text-sky-300',
  active: 'bg-emerald-900 text-emerald-300',
  disabled: 'bg-red-900 text-red-300',
  unavailable: 'bg-amber-900 text-amber-300',
}

export function MineScreen({
  appVersion,
  loader,
  onOpenSettings,
  onOpenCache,
  onOpenDiagnostics,
}: MineScreenProps) {
  const records = useMemo(() => (loader === undefined ? [] : [...loader.diagnostics()]), [loader])

  return (
    <ScrollView className='size-full bg-neutral-950' contentContainerClassName='gap-4 p-3 pb-8'>
      <View className='items-center gap-1 py-8'>
        <View className='size-16 items-center justify-center rounded-2xl bg-sky-500'>
          <Text className='text-2xl font-bold text-white'>Δ</Text>
        </View>
        <Text className='mt-2 text-lg font-semibold text-neutral-100'>Delta Comic</Text>
        <Text className='text-xs text-neutral-500'>{appVersion ?? '开发版'}</Text>
      </View>

      <View className='overflow-hidden rounded-xl bg-neutral-900'>
        <ActionRow label='通用设置' onPress={onOpenSettings} />
        <Divider />
        <ActionRow label='缓存管理' onPress={onOpenCache} />
        <Divider />
        <ActionRow label='诊断信息' onPress={onOpenDiagnostics} />
      </View>

      {loader !== undefined && (
        <View className='gap-2'>
          <Text className='px-1 text-sm font-semibold text-neutral-300'>插件管理</Text>
          {records.length === 0 ? (
            <View className='rounded-xl bg-neutral-900 px-3 py-6'>
              <Text className='text-center text-sm text-neutral-500'>暂无已加载插件</Text>
            </View>
          ) : (
            records.map(record => (
              <View key={record.id} className='gap-1 rounded-xl bg-neutral-900 p-3'>
                <View className='flex-row items-center gap-2'>
                  <Text numberOfLines={1} className='flex-1 text-sm font-medium text-neutral-100'>
                    {record.id}
                  </Text>
                  <View className={`rounded-full px-2 py-0.5 ${STATE_BADGES[record.state]}`}>
                    <Text className='text-xs'>{STATE_LABELS[record.state]}</Text>
                  </View>
                </View>
                <Text className='text-xs text-neutral-500'>v{record.version}</Text>
                {record.failure !== undefined && (
                  <Text numberOfLines={2} className='text-xs text-red-400'>
                    {record.failure.stage}：{record.failure.message}
                  </Text>
                )}
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  )
}

function ActionRow(props: { readonly label: string; readonly onPress?: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      className='flex-row items-center justify-between px-4 py-3.5 active:opacity-70'
    >
      <Text className='text-sm text-neutral-100'>{props.label}</Text>
      <Text className='text-base text-neutral-600'>›</Text>
    </Pressable>
  )
}

function Divider() {
  return <View className='ms-14 h-px bg-neutral-800' />
}