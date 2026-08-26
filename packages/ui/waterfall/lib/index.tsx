/**
 * 瀑布流布局。
 *
 * - columnsForWidth：断点列数纯函数（compact 2 列 / medium 3 列 / expanded 4 列）
 * - Waterfall：等宽多列纵向分发的滚动容器；首期面向千级条目规模，暂不做虚拟化
 */
import type { ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import type {} from 'uniwind/types'

export { WATERFALL_BREAKPOINTS } from './columns'
import { columnsForWidth } from './columns'

export interface WaterfallProps {
  /** 参与分列的子项，按 index % 列数 分发到各列。 */
  items: readonly ReactNode[]
  /** 容器像素宽度；由调用方测量后传入。 */
  width: number
  /** 列间距与行间距，默认 8。 */
  gap?: number
  className?: string
}

function chunkIntoColumns(items: readonly ReactNode[], columns: number): ReactNode[][] {
  const columnsOfNodes: ReactNode[][] = Array.from({ length: columns }, () => [])
  for (const [index, node] of items.entries()) {
    columnsOfNodes[index % columns].push(node)
  }
  return columnsOfNodes
}

/** 等宽瀑布流：各列独立纵向堆叠，列内按分发顺序排列。 */
export function Waterfall({ items, width, gap = 8, className }: WaterfallProps) {
  if (items.length === 0 || width <= 0) return null
  const columnNodes = chunkIntoColumns(items, columnsForWidth(width))
  return (
    <ScrollView
      className={`flex-1 ${className ?? ''}`}
      contentContainerClassName='p-2'
      showsVerticalScrollIndicator={false}
    >
      <View className='flex-row' style={{ margin: -gap / 2 }}>
        {columnNodes.map((column, columnIndex) => (
          <View key={columnIndex} className='flex-1' style={{ margin: gap / 2 }}>
            {column.map((node, nodeIndex) => (
              <View key={nodeIndex} style={{ marginBottom: gap }}>
                {node}
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}