/**
 * expo-image 的 Web 替身。
 *
 * expo-image 是 RN 原生包（预打包产物引用 @react-native/assets-registry，
 * react-native-web 不提供），无法走 Vite 优化器/管线。此 stub 用 RNW 的
 * Image 承载，把 expo-image 的 contentFit 翻译成 RNW 的 resizeMode。
 */
import { Image as RNWImage } from 'react-native'
import type { ImageProps as RNWImageProps, ImageStyle, StyleProp } from 'react-native'

type ContentFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down'

export interface ExpoImageProps {
  source?: { uri?: string } | number
  className?: string
  style?: StyleProp<ImageStyle>
  contentFit?: ContentFit
  accessibilityLabel?: string
}

const RESIZE_MODE: Record<ContentFit, NonNullable<RNWImageProps['resizeMode']>> = {
  cover: 'cover',
  contain: 'contain',
  fill: 'stretch',
  none: 'center',
  'scale-down': 'contain',
}

export function Image({
  source,
  className,
  style,
  contentFit,
  accessibilityLabel,
}: ExpoImageProps) {
  return (
    <RNWImage
      source={typeof source === 'number' ? source : { uri: source?.uri }}
      className={className}
      style={style}
      resizeMode={contentFit === undefined ? undefined : RESIZE_MODE[contentFit]}
      accessibilityLabel={accessibilityLabel}
    />
  )
}