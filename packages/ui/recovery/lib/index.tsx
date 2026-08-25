import type { PluginRecord, PluginStage } from '@delta-comic/loader'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type {} from 'uniwind/types'

export const recoveryPackageVersion = '1.0.0'

export interface RecoveryScreenProps {
  records: readonly PluginRecord[]
  onRetry: (id: string) => void
  onUninstall: (id: string) => void
  onExportDiagnostics: () => void
}

const STAGE_LABELS: Record<PluginStage, string> = {
  verify: '校验',
  migrate: '迁移',
  activate: '激活',
  rollback: '回滚',
}

function isRecoverable(record: PluginRecord): boolean {
  return record.state === 'disabled' || record.state === 'unavailable'
}

function describe(record: PluginRecord): string {
  if (record.failure) return `${STAGE_LABELS[record.failure.stage]}失败：${record.failure.message}`
  if (record.state === 'unavailable') return '依赖不可用'
  return record.state
}

export function RecoveryScreen({
  records,
  onRetry,
  onUninstall,
  onExportDiagnostics,
}: RecoveryScreenProps) {
  const failed = records.filter(isRecoverable)
  return (
    <View className='flex-1 bg-neutral-50 dark:bg-neutral-950'>
      <View className='flex-row items-center justify-between px-4 pt-4 pb-2'>
        <Text className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>
          插件恢复
        </Text>
        <Pressable
          className='rounded-lg bg-neutral-200 px-3 py-1.5 active:bg-neutral-300 dark:bg-neutral-800'
          onPress={onExportDiagnostics}
        >
          <Text className='text-sm text-neutral-700 dark:text-neutral-300'>导出诊断</Text>
        </Pressable>
      </View>
      <ScrollView className='flex-1' contentContainerClassName='px-4 pb-8 gap-3'>
        {failed.map(record => (
          <View
            key={`${record.id}/${record.version}`}
            className='gap-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900'
          >
            <View className='flex-row items-baseline justify-between'>
              <Text className='font-medium text-neutral-900 dark:text-neutral-100'>
                {record.id}
              </Text>
              <Text className='text-xs text-neutral-500 dark:text-neutral-400'>
                {record.version}
              </Text>
            </View>
            <Text className='text-sm text-red-600 dark:text-red-400'>{describe(record)}</Text>
            {record.dependencies.length > 0 && (
              <Text className='text-xs text-neutral-500 dark:text-neutral-400'>
                依赖：{record.dependencies.join('、')}
              </Text>
            )}
            <View className='flex-row gap-2 self-end'>
              <Pressable
                className='rounded-lg bg-pink-500/10 px-3 py-1.5 active:bg-pink-500/20'
                onPress={() => onRetry(record.id)}
              >
                <Text className='text-sm text-pink-600 dark:text-pink-400'>重试</Text>
              </Pressable>
              <Pressable
                className='rounded-lg bg-red-500/10 px-3 py-1.5 active:bg-red-500/20'
                onPress={() => onUninstall(record.id)}
              >
                <Text className='text-sm text-red-600 dark:text-red-400'>卸载</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}