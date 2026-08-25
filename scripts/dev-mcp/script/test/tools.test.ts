import { writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { defaultConfig, loadConfig, type DevMcpConfig } from '../../src/config'
import { buildTools, isControlAllowed } from '../../src/tools'

describe('config', () => {
  it('默认配置生成随机配对 token 且操控全关', () => {
    const config = defaultConfig()
    expect(config.port).toBe(7529)
    expect(config.token).toMatch(/^[0-9a-f]{32}$/)
    expect(config.allow).toEqual({})
  })

  it('loadConfig 合并文件字段，缺省回落默认值', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dev-mcp-'))
    const path = join(dir, 'dev-mcp.json')
    const partial = { port: 8000, allow: { navigate: true } } satisfies Partial<DevMcpConfig>
    writeFileSync(path, JSON.stringify(partial), 'utf8')

    const loaded = loadConfig(path)
    expect(loaded).toMatchObject({ port: 8000, allow: { navigate: true } })
    expect(loaded.token).toMatch(/^[0-9a-f]{32}$/)

    const fallback = loadConfig()
    expect(fallback.port).toBe(7529)
  })
})

describe('tools', () => {
  it('观察类工具默认可用，操控类须逐项放行', () => {
    expect(isControlAllowed('app_info', {})).toBe(true)
    expect(isControlAllowed('navigate', {})).toBe(false)
    expect(isControlAllowed('navigate', { navigate: true })).toBe(true)
    expect(isControlAllowed('plugin_reload', { plugin_reload: true })).toBe(true)
  })

  it('buildTools 按门控过滤注册表并透传调用与审计', async () => {
    const calls: Array<{ tool: string; params: Record<string, unknown> }> = []
    const audits: unknown[] = []
    const tools = buildTools({
      request: async (tool, params) => {
        calls.push({ tool, params })
        return { echoed: tool }
      },
      allow: {},
      audit: entry => audits.push(entry),
    })

    const names = tools.map(tool => tool.name)
    expect(names).toContain('app_info')
    expect(names).not.toContain('navigate')

    const appInfo = tools.find(tool => tool.name === 'app_info')
    expect(appInfo).toBeDefined()
    const appInfoInput = appInfo?.input as { type?: string }
    expect(appInfoInput.type).toBe('object')
    await expect(appInfo?.run({})).resolves.toEqual({ echoed: 'app_info' })

    await expect(
      async () =>
        await buildTools({
          request: async () => {
            throw new Error('没有已连接的调试设备')
          },
          allow: { navigate: true },
          audit: entry => audits.push(entry),
        })
          .find(tool => tool.name === 'navigate')
          ?.run({ key: 'core/detail' }),
    ).rejects.toThrow('没有已连接的调试设备')

    expect(calls[0]).toEqual({ tool: 'app_info', params: {} })
    expect(audits.length).toBe(2)
    expect(audits[0]).toMatchObject({ tool: 'app_info', ok: true })
    expect(audits[1]).toMatchObject({ tool: 'navigate', ok: false, error: '没有已连接的调试设备' })
  })

  it('allow.navigate 开启后 navigate 进入工具列表', () => {
    const tools = buildTools({
      request: async () => ({}),
      allow: { navigate: true },
      audit: () => undefined,
    })
    expect(tools.map(tool => tool.name)).toContain('navigate')
  })
})