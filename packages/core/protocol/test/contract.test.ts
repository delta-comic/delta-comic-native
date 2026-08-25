import { Type } from 'typebox'
import { describe, expect, it } from 'vitest'

import {
  isUIOverrideRegistration,
  isValidUiKey,
  type PlayerInput,
  type PlayerInputDefinition,
  type UIRegistry,
} from '../lib/index'

declare module '../lib/index' {
  interface PlayerInputRegistry {
    'comic/page': PlayerInputDefinition<ReturnType<typeof comicPageSchema>>
    'web/viewer': PlayerInputDefinition<ReturnType<typeof webViewerSchema>>
  }
  interface UIRegistry {
    'ui/button': () => string
  }
}

function comicPageSchema() {
  return Type.Object({ comicId: Type.String(), chapterId: Type.Number() })
}

function webViewerSchema() {
  return Type.Object({ url: Type.String() })
}

type Expect<T extends true> = T

export type _PlayerAugmentationWorks = Expect<
  PlayerInput<'comic/page'> extends { comicId: string; chapterId: number } ? true : false
>
export type _RedirectTargetTypingWorks = Expect<
  Extract<
    { kind: 'redirect'; key: 'web/viewer'; input: PlayerInput<'web/viewer'> },
    { kind: 'redirect' }
  >['input'] extends { url: string }
    ? true
    : false
>
export type _UiRegistryAugmentationWorks = Expect<
  UIRegistry['ui/button'] extends () => string ? true : false
>

describe('分层 key 约定', () => {
  it('接受 layer/name 形式的 key', () => {
    expect(isValidUiKey('ui/button')).toBe(true)
    expect(isValidUiKey('ui/banner-item')).toBe(true)
  })

  it('拒绝单段、大写与空段 key', () => {
    expect(isValidUiKey('button')).toBe(false)
    expect(isValidUiKey('UI/button')).toBe(false)
    expect(isValidUiKey('ui/')).toBe(false)
  })
})

describe('注册描述符判别', () => {
  it('区分基础注册与覆盖注册', () => {
    const base = { id: 'core', version: '1.0.0', component: () => 'x' }
    expect(isUIOverrideRegistration(base)).toBe(false)
    const override = {
      ...base,
      priority: 1,
      override: { targetId: 'core', compatibleVersion: '^1.0.0' },
    }
    expect(isUIOverrideRegistration(override)).toBe(true)
  })
})