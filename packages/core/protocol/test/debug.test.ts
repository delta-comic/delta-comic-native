import { describe, expect, it } from 'vitest'

import {
  DEBUG_TOOLS,
  CONTROL_TOOLS,
  OBSERVE_TOOLS,
  findDebugTool,
  makeDebugError,
  makeDebugRequest,
  makeDebugSuccess,
  parseDebugMessage,
} from '../lib/index'

const hello = { v: 1, kind: 'hello', appId: 'sim-01', platform: 'ios', appVersion: '1.0.0' }

describe('调试信封校验', () => {
  it('三类消息均通过并保留判别联合类型', () => {
    const request = makeDebugRequest('r-1', 'app_info', {})
    const success = makeDebugSuccess('r-1', { appId: 'sim-01' })
    const failure = makeDebugError('r-1', 'TOOL_NOT_FOUND', 'unknown tool')

    for (const message of [hello, request, success, failure]) {
      const result = parseDebugMessage(message)
      expect(result.ok).toBe(true)
      expect(result).toMatchObject({ ok: true, message: { kind: message.kind } })
    }
  })

  it('版本字段必须是字面量 1', () => {
    const result = parseDebugMessage({ ...hello, v: 2 })
    expect(result.ok).toBe(false)
  })

  it('未知 kind 与多余字段被拒绝', () => {
    expect(parseDebugMessage({ ...hello, kind: 'ping' }).ok).toBe(false)
    expect(parseDebugMessage({ ...makeDebugRequest('r-1', 'app_info', {}), extra: true }).ok).toBe(
      false,
    )
  })

  it('失败响应必须携带 code 与 message', () => {
    expect(parseDebugMessage({ ...makeDebugError('r-1', 'X', ''), ok: false }).ok).toBe(true)
    expect(parseDebugMessage({ ...makeDebugError('r-1', 'X', 'm'), error: {} }).ok).toBe(false)
  })

  it('空对象与非对象输入被拒绝并给出 issue path', () => {
    const empty = parseDebugMessage({})
    expect(empty.ok).toBe(false)
    expect(empty).toMatchObject({ issues: expect.any(Array) })

    expect(parseDebugMessage(null).ok).toBe(false)
    expect(parseDebugMessage(42).ok).toBe(false)
  })
})

describe('工具注册表', () => {
  it('观察九项与操控四项齐备且互斥', () => {
    expect(DEBUG_TOOLS).toHaveLength(14)
    expect(OBSERVE_TOOLS.map(tool => tool.name)).toEqual([
      'app_info',
      'plugin_list',
      'plugin_detail',
      'db_schema',
      'db_query',
      'logs_tail',
      'logs_search',
      'events_recent',
      'registry_list',
      'diagnostics_export',
    ])
    expect(CONTROL_TOOLS.map(tool => tool.name)).toEqual([
      'plugin_reload',
      'plugin_enable',
      'plugin_disable',
      'navigate',
    ])
  })

  it('工具名全局唯一', () => {
    const names = DEBUG_TOOLS.map(tool => tool.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('按名称检索工具', () => {
    expect(findDebugTool('navigate')?.kind).toBe('control')
    expect(findDebugTool('db_query')?.kind).toBe('observe')
    expect(findDebugTool('missing')).toBeUndefined()
  })
})