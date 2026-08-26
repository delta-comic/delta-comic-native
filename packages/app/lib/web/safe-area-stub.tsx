import { createContext, useContext, type ReactNode } from 'react'
/**
 * Web 端占位：safe-area-context 在 Web 无实际内嵌差异，零值直通。
 */
import { View } from 'react-native'

export interface Insets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export const initialWindowMetrics = null

export const SafeAreaContext = createContext<Insets>({ top: 0, bottom: 0, left: 0, right: 0 })

export const SafeAreaInsetsContext = SafeAreaContext

export function SafeAreaProvider(props: { readonly children?: ReactNode }) {
  return <View style={{ flex: 1 }}>{props.children}</View>
}

export function SafeAreaConsumer(props: { readonly children: (insets: Insets) => ReactNode }) {
  return props.children(useContext(SafeAreaContext))
}

export function useSafeAreaInsets(): Insets {
  return useContext(SafeAreaContext)
}

export function SafeAreaView(props: Parameters<typeof View>[0]) {
  return <View {...props} />
}