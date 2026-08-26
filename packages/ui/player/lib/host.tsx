import { PlayerResolveError, type PlayerService, type ResolvedPlayer } from '@delta-comic/player'
/**
 * PlayerHost：播放器容器（architecture.md §3.6）。
 *
 * - 只负责解析挂载、loading/missing/error 呈现与卸载清理（dispose + scope.close）
 * - 播放器本体 UI 由插件实例 render() 提供，宿主不感知业务形态
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type {} from 'uniwind/types'

import { phaseForError, type PlayerPhase } from './state'

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

interface ResolveAttempt {
  readonly playerKey: string
  readonly input: unknown
  readonly settled:
    | { readonly ok: true; readonly value: ResolvedPlayer }
    | { readonly ok: false; readonly error: unknown }
}

export function PlayerHost({ players, playerKey, input, onClose, renderError }: PlayerHostProps) {
  // 以请求标识内嵌结果，渲染期比对丢弃过期响应，避免 effect 内同步 setState。
  const [attempt, setAttempt] = useState<ResolveAttempt>()

  useEffect(() => {
    let active = true
    players.resolveErased(playerKey, input).then(
      value => {
        if (active) setAttempt({ playerKey, input, settled: { ok: true, value } })
      },
      error => {
        if (active) setAttempt({ playerKey, input, settled: { ok: false, error } })
      },
    )
    return () => {
      active = false
    }
  }, [players, playerKey, input])

  const current = attempt?.playerKey === playerKey && attempt.input === input ? attempt : undefined

  const settledValue = current?.settled.ok === true ? current.settled.value : undefined
  useEffect(() => {
    if (settledValue === undefined) return undefined
    return () => {
      void settledValue.instance.dispose?.()
      void settledValue.scope.close()
    }
  }, [settledValue])

  const phase: PlayerPhase =
    current === undefined
      ? 'resolving'
      : current.settled.ok
        ? 'ready'
        : current.settled.error instanceof PlayerResolveError
          ? phaseForError(current.settled.error.code)
          : 'error'
  const failure = current?.settled.ok === false ? current.settled.error : undefined

  if (phase === 'ready' && settledValue !== undefined) return settledValue.instance.render()

  if (phase === 'resolving') {
    return (
      <View className='size-full items-center justify-center bg-black'>
        <ActivityIndicator />
      </View>
    )
  }

  if (phase === 'missing') {
    return (
      <PlayerFallback label='内容不可用或已下架' onClose={onClose}>
        <Text className='text-sm text-neutral-400'>该内容没有可用的播放器</Text>
      </PlayerFallback>
    )
  }

  if (renderError !== undefined) {
    return <View className='size-full bg-black'>{renderError(failure)}</View>
  }
  return (
    <PlayerFallback label='播放失败' onClose={onClose}>
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