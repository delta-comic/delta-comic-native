/**
 * PlayerHost：播放器容器（architecture.md §3.6）。
 *
 * - 只负责解析挂载、loading/missing/error 呈现与卸载清理（dispose + scope.close）
 * - 播放器本体 UI 由插件实例 render() 提供，宿主不感知业务形态
 */
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { ReactNode } from 'react'

import { PlayerResolveError, type PlayerService, type ResolvedPlayer } from '@delta-comic/player'

import { phaseForError, type PlayerPhase } from './state'

import type {} from 'uniwind/types'

export interface PlayerHostProps {
  readonly players: PlayerService
  /** 运行期协议 key（来自路由参数），经擦除入口解析。 */
  readonly playerKey: string
  readonly input: unknown
  /** 提供时渲染右上角关闭按钮。 */
  readonly onClose?: () => void
  /** 自定义错误呈现；缺省渲染通用错误文案。 */
  readonly renderError?: (error: unknown) => ReactNode
}

export function PlayerHost({ players, playerKey, input, onClose, renderError }: PlayerHostProps) {
  const [phase, setPhase] = useState<PlayerPhase>('resolving')
  const [resolved, setResolved] = useState<ResolvedPlayer>()
  const [failure, setFailure] = useState<unknown>()

  useEffect(() => {
    let active = true
    setPhase('resolving')
    setFailure(undefined)
    players.resolveErased(playerKey, input).then(
      result => {
        if (!active) {
          void result.instance.dispose?.()
          result.scope.close()
          return
        }
        setResolved(result)
        setPhase('ready')
      },
      error => {
        if (!active) return
        setFailure(error)
        setPhase(error instanceof PlayerResolveError ? phaseForError(error.code) : 'error')
      },
    )
    return () => {
      active = false
    }
  }, [players, playerKey, input])

  useEffect(() => {
    if (resolved === undefined) return undefined
    return () => {
      void resolved.instance.dispose?.()
      resolved.scope.close()
    }
  }, [resolved])

  if (phase === 'ready' && resolved !== undefined) return resolved.instance.render()

  if (phase === 'resolving') {
    return (
      <View className='size-full items-center justify-center bg-black'>
        <ActivityIndicator />
      </View>
    )
  }

  if (phase === 'missing') {
    return (
      <PlayerFallback onClose={onClose} label='内容不可用或已下架'>
        <Text className='text-sm text-neutral-400'>该内容没有可用的播放器</Text>
      </PlayerFallback>
    )
  }

  if (renderError !== undefined) {
    return (
      <View className='size-full bg-black'>
        {renderError(failure)}
      </View>
    )
  }
  return (
    <PlayerFallback onClose={onClose} label='播放失败'>
      <Text className='text-sm text-neutral-400'>加载播放器时出现问题，请稍后重试</Text>
    </PlayerFallback>
  )
}

function PlayerFallback({
  label,
  onClose,
  children,
}: {
  readonly label: string
  readonly onClose?: () => void
  readonly children: ReactNode
}) {
  return (
    <View className='size-full items-center justify-center gap-1 bg-black'>
      <Text className='text-base font-medium text-neutral-100'>{label}</Text>
      {children}
      {onClose !== undefined && (
        <Pressable onPress={onClose} className='active:opacity-70'>
          <Text className='mt-3 text-sm text-neutral-300'>关闭</Text>
        </Pressable>
      )}
    </View>
  )
}
