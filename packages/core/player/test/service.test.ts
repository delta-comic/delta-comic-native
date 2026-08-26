import type { PlayerInput, PlayerResolveResult } from '@delta-comic/protocol'
import { ResourceScope } from '@delta-comic/resource'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vitest'

import { MAX_REDIRECT_DEPTH, PlayerResolveError, PlayerService } from '../lib/service'
import type { PlayerProvider, PlayerResolvedEvent } from '../lib/service'

import { createContext } from './util'

const ComicSchema = Type.Object({ id: Type.String() })
const ReaderSchema = Type.Object({ chapter: Type.Number() })
const HopSchema = Type.Object({ id: Type.String() })

type HopKey =
  | 'hop-1'
  | 'hop-2'
  | 'hop-3'
  | 'hop-4'
  | 'hop-5'
  | 'hop-6'
  | 'hop-7'
  | 'hop-8'
  | 'hop-9'

declare module '@delta-comic/protocol' {
  interface PlayerInputRegistry {
    'comic': { readonly schema: typeof ComicSchema; readonly version: string }
    'reader': { readonly schema: typeof ReaderSchema; readonly version: string }
    'hop-1': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-2': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-3': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-4': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-5': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-6': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-7': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-8': { readonly schema: typeof HopSchema; readonly version: string }
    'hop-9': { readonly schema: typeof HopSchema; readonly version: string }
  }
}

interface TestHarness {
  readonly ctx: ReturnType<typeof createContext>
  readonly service: PlayerService
  readonly scopes: ResourceScope[]
}

function createHarness(): TestHarness {
  const ctx = createContext()
  const scopes: ResourceScope[] = []
  const service = new PlayerService(ctx, {
    createScope: () => {
      const scope = new ResourceScope()
      scopes.push(scope)
      return scope
    },
  })
  return { ctx, service, scopes }
}

function instanceOf(providerId: string): {
  kind: 'instance'
  instance: { providerId: string; render: () => null }
} {
  return { kind: 'instance', instance: { providerId, render: () => null } }
}

describe('PlayerService', () => {
  it('重复 key 注册抛错且注销后可重注册', () => {
    const { service } = createHarness()
    const base: PlayerProvider<'comic'> = {
      key: 'comic',
      definition: { schema: ComicSchema, version: '1.0.0' },
      resolve: async () => instanceOf('p'),
    }
    const dispose = service.registerPlayer(base)
    expect(() => service.registerPlayer(base)).toThrow(/重复/)
    dispose()
    expect(() => service.registerPlayer(base)).not.toThrow()
  })

  it('协议版本非法抛 TypeError', () => {
    const { service } = createHarness()
    const broken: PlayerProvider<'comic'> = {
      key: 'comic',
      definition: { schema: ComicSchema, version: 'not-semver' },
      resolve: async () => instanceOf('p'),
    }
    expect(() => service.registerPlayer(broken)).toThrow(TypeError)
    expect(() => service.registerPlayer(broken)).toThrow(/semver/)
  })

  it('解析到实例并广播事件链，scope 保持打开', async () => {
    const harness = createHarness()
    const events: PlayerResolvedEvent[] = []
    harness.ctx.on('player/resolved', event => {
      events.push(event)
    })
    harness.service.registerPlayer({
      key: 'comic',
      definition: { schema: ComicSchema, version: '1.0.0' },
      resolve: async () => instanceOf('p1'),
    })
    const resolved = await harness.service.resolve('comic', { id: 'x' })
    expect(resolved.instance.providerId).toBe('p1')
    expect(resolved.scope.closed).toBe(false)
    await resolved.scope.close()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ key: 'comic', providerId: 'p1', chain: ['comic'] })
  })

  it('redirect 两跳传递转换后的输入并记录链', async () => {
    const harness = createHarness()
    const seenInputs: unknown[] = []
    harness.service.registerPlayer({
      key: 'comic',
      definition: { schema: ComicSchema, version: '1.0.0' },
      resolve: async input => ({
        kind: 'redirect',
        key: 'reader',
        input: { chapter: input.id.length },
      }),
    })
    harness.service.registerPlayer({
      key: 'reader',
      definition: { schema: ReaderSchema, version: '1.0.0' },
      resolve: async input => {
        seenInputs.push(input)
        return instanceOf('reader-p')
      },
    })
    const resolved = await harness.service.resolve('comic', { id: 'abc' })
    expect(seenInputs).toEqual([{ chapter: 3 }])
    expect(resolved.instance.providerId).toBe('reader-p')
    await resolved.scope.close()
  })

  it('重定向成环抛 redirect-cycle 且关闭 scope', async () => {
    const harness = createHarness()
    const loopTo = (key: HopKey, target: HopKey): PlayerProvider<HopKey> => ({
      key,
      definition: { schema: HopSchema, version: '1.0.0' },
      resolve: async input => ({ kind: 'redirect', key: target, input }),
    })
    harness.service.registerPlayer(loopTo('hop-1', 'hop-2'))
    harness.service.registerPlayer(loopTo('hop-2', 'hop-1'))
    const error = await harness.service.resolve('hop-1', { id: 'x' }).catch(reason => reason)
    expect(error).toBeInstanceOf(PlayerResolveError)
    expect(error.code).toBe('redirect-cycle')
    expect(harness.scopes[0]?.closed).toBe(true)
  })

  it('超过最大深度抛 redirect-depth', async () => {
    const harness = createHarness()
    const hops: readonly HopKey[] = [
      'hop-1',
      'hop-2',
      'hop-3',
      'hop-4',
      'hop-5',
      'hop-6',
      'hop-7',
      'hop-8',
      'hop-9',
    ]
    for (let index = 0; index < MAX_REDIRECT_DEPTH; index += 1) {
      const source = hops[index]
      const target = hops[index + 1]
      if (source === undefined || target === undefined) continue
      harness.service.registerPlayer({
        key: source,
        definition: { schema: HopSchema, version: '1.0.0' },
        resolve: async input => ({ kind: 'redirect', key: target, input }),
      })
    }
    harness.service.registerPlayer({
      key: 'hop-9',
      definition: { schema: HopSchema, version: '1.0.0' },
      resolve: async () => instanceOf('deep'),
    })
    const error = await harness.service.resolve('hop-1', { id: 'x' }).catch(reason => reason)
    expect(error).toBeInstanceOf(PlayerResolveError)
    expect(error.code).toBe('redirect-depth')
    expect(harness.scopes[0]?.closed).toBe(true)
  })

  it('输入未通过 schema 校验抛 input-invalid 且不触达 provider', async () => {
    const harness = createHarness()
    // 模拟插件运行时 schema 与注册声明不一致：声明 id:string，实际要求 number。
    const resolve = vi.fn<(input: PlayerInput<'comic'>) => Promise<PlayerResolveResult>>()
    harness.service.registerPlayer({
      key: 'comic',
      definition: { schema: Type.Object({ id: Type.Number() }), version: '1.0.0' },
      resolve,
    })
    const error = await harness.service.resolve('comic', { id: 'x' }).catch(reason => reason)
    expect(error).toBeInstanceOf(PlayerResolveError)
    expect(error.code).toBe('input-invalid')
    expect(resolve).not.toHaveBeenCalled()
    expect(harness.scopes[0]?.closed).toBe(true)
  })

  it('注销后解析抛 player-missing 并关闭 scope', async () => {
    const harness = createHarness()
    const dispose = harness.service.registerPlayer({
      key: 'comic',
      definition: { schema: ComicSchema, version: '1.0.0' },
      resolve: async () => instanceOf('p'),
    })
    dispose()
    const error = await harness.service.resolve('comic', { id: 'x' }).catch(reason => reason)
    expect(error).toBeInstanceOf(PlayerResolveError)
    expect(error.code).toBe('player-missing')
    expect(harness.scopes[0]?.closed).toBe(true)
  })

  it('keys 返回确定性排序的注册 key', () => {
    const harness = createHarness()
    const make = (key: 'comic' | 'reader'): PlayerProvider<'comic' | 'reader'> => ({
      key,
      definition: { schema: key === 'comic' ? ComicSchema : ReaderSchema, version: '1.0.0' },
      resolve: async () => instanceOf('p'),
    })
    harness.service.registerPlayer(make('reader'))
    harness.service.registerPlayer(make('comic'))
    expect(harness.service.keys()).toEqual(['comic', 'reader'])
  })
})