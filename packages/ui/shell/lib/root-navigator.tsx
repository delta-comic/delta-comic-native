/**
 * RootNavigator：NavigationContainer + Tabs 容器 + native-stack push 页。
 *
 * - 四端统一 native-stack；Web 由 React Navigation 自动降级为无动画切换
 * - tab 根路由来自 TAB_ROUTE_KEYS 约定，push 页遍历注册表剩余 key 动态挂载
 * - 容器命令面经适配器绑定到 ctx.navigation，深链/Web URL 经 buildLinkingConfig 接入
 */
import {
  buildLinkingConfig,
  NavigationService,
  RouteRegistryService,
  type NavigationCommands,
  type Routes,
} from '@delta-comic/navigation'
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs'
import {
  NavigationContainer,
  type NavigationContainerRefWithCurrent,
  type ParamListBase,
} from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { createElement, useEffect, useMemo, useRef } from 'react'
import { Text, View } from 'react-native'

import { BottomNavigation, type BottomTabItem } from './bottom-navigation'
import { splitTabRoutes, TAB_ROUTE_KEYS, type TabRouteKey } from './tab-routes'

const Tabs = createBottomTabNavigator()
const Stack = createNativeStackNavigator()

export const DEFAULT_TAB_LABELS: Readonly<Record<TabRouteKey, string>> = {
  'core/home': '首页',
  'core/follow': '关注',
  'core/bookshelf': '书架',
  'core/mine': '我的',
}

export interface RootNavigatorProps {
  /** 宿主 cordis 上下文，提供 routeRegistry 与 navigation 服务。 */
  readonly ctx: {
    readonly routeRegistry: RouteRegistryService
    readonly navigation: NavigationService
  }
  /** 深链/Web URL 前缀，默认 ['delta-comic://']。 */
  readonly linkingPrefixes?: readonly string[]
  /** FAB 主操作标签，默认 '添加'。 */
  readonly primaryActionLabel?: string
  /** FAB 按压回调；未提供时按压无效果。 */
  readonly onPrimaryAction?: () => void
  /** 四槽标签覆盖，按 TAB_ROUTE_KEYS 顺序。 */
  readonly tabLabels?: readonly [string, string, string, string]
}

export function RootNavigator(props: RootNavigatorProps) {
  const containerRef = useRef<NavigationContainerRefWithCurrent<ParamListBase> | null>(null)
  const split = useMemo(() => splitTabRoutes(props.ctx.routeRegistry.keys()), [props.ctx])
  const linking = useMemo(
    () =>
      buildLinkingConfig({
        prefixes: props.linkingPrefixes ?? ['delta-comic://'],
        routes: props.ctx.routeRegistry.keys(),
        tabRoutes: split.tabKeys,
      }),
    [props.ctx, props.linkingPrefixes, split],
  )

  useEffect(() => {
    const ref = containerRef.current
    if (ref === null) return undefined
    const commands: NavigationCommands = {
      navigate: (name, params) => {
        ref.navigate(name, params)
      },
      goBack: () => {
        ref.goBack()
      },
      canGoBack: () => ref.canGoBack(),
    }
    return props.ctx.navigation.attach(commands)
  }, [props.ctx])

  return (
    <NavigationContainer ref={containerRef} linking={linking}>
      <Stack.Navigator>
        <Stack.Screen name='tabs' options={{ headerShown: false }}>
          {() => (
            <TabsHost
              ctx={props.ctx}
              tabKeys={split.tabKeys}
              primaryActionLabel={props.primaryActionLabel ?? '添加'}
              onPrimaryAction={props.onPrimaryAction}
              tabLabels={props.tabLabels}
            />
          )}
        </Stack.Screen>
        {split.pushKeys.map(key => (
          <Stack.Screen key={key} name={key} component={createPushEntry(props.ctx.routeRegistry)} />
        ))}
      </Stack.Navigator>
    </NavigationContainer>
  )
}

function TabsHost(props: {
  readonly ctx: RootNavigatorProps['ctx']
  readonly tabKeys: readonly string[]
  readonly primaryActionLabel: string
  readonly onPrimaryAction?: () => void
  readonly tabLabels?: readonly [string, string, string, string]
}) {
  return (
    <Tabs.Navigator
      screenOptions={{ headerShown: false }}
      tabBar={barProps => (
        <ShellTabBar
          barProps={barProps}
          ctx={props.ctx}
          tabKeys={props.tabKeys}
          labels={props.tabLabels}
          primaryActionLabel={props.primaryActionLabel}
          onPrimaryAction={props.onPrimaryAction}
        />
      )}
    >
      {props.tabKeys.map(key => (
        <Tabs.Screen key={key} name={key}>
          {() => <TabPlaceholder title={tabLabel(key, props.tabLabels)} />}
        </Tabs.Screen>
      ))}
    </Tabs.Navigator>
  )
}

interface ShellTabBarProps {
  readonly barProps: BottomTabBarProps
  readonly ctx: RootNavigatorProps['ctx']
  readonly tabKeys: readonly string[]
  readonly labels?: readonly [string, string, string, string]
  readonly primaryActionLabel: string
  readonly onPrimaryAction?: () => void
}

/** 自定义 tabBar：把导航容器状态映射进五槽 BottomNavigation。 */
function ShellTabBar(props: ShellTabBarProps) {
  const { state, navigation } = props.barProps
  const items = props.tabKeys.map((key): BottomTabItem => ({ key, label: tabLabel(key, props.labels) }))
  if (items.length !== 4) return null
  const activeKey = state.routes[state.index]?.name ?? ''
  return (
    <BottomNavigation
      tabs={items}
      activeKey={activeKey}
      onTabPress={key => {
        navigation.navigate(key)
      }}
      primaryActionLabel={props.primaryActionLabel}
      onPrimaryActionPress={() => props.onPrimaryAction?.()}
    />
  )
}

function tabLabel(key: string, override: ShellTabBarProps['labels']): string {
  const index = TAB_ROUTE_KEYS.indexOf(key as TabRouteKey)
  return (index >= 0 ? override?.[index] : undefined) ?? DEFAULT_TAB_LABELS[key as TabRouteKey] ?? key
}

function TabPlaceholder(props: { readonly title: string }) {
  return (
    <View className='flex-1 items-center justify-center bg-neutral-950'>
      <Text className='text-neutral-500'>{props.title}</Text>
    </View>
  )
}

/**
 * push 页包装：从注册表取回屏幕组件并注入路由参数。
 * 组件工厂置于渲染外，避免父级重渲染导致栈页重挂载。
 */
function createPushEntry(registry: RouteRegistryService) {
  return function PushEntry(props: {
    readonly route: { readonly name: string; readonly params?: object | undefined }
  }) {
    const screen = registry.resolveScreen(props.route.name)
    if (screen === undefined) return null
    // 存在类型还原点：params 仅经 navigate()/linking 写入且均受 Routes 约束，
    // 导航容器运行时回读宽类型，此处对齐注册表静态绑定的参数联合。
    return createElement(screen, {
      params: props.route.params as Routes[keyof Routes],
    })
  }
}
