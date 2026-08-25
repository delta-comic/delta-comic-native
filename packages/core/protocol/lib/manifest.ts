import { validRange } from 'semver'
/**
 * 插件 manifest schema 与运行时校验。
 *
 * plugin.zip 的 manifest.json 必须通过本 schema：
 * - 入口按平台声明（common 必填，web/android/macos/windows 可选）+ fallback
 * - runtime 记录 RN/Hermes 版本范围、字节码版本、CPU 架构与编译选项摘要
 * - network.multiEdge 是 EdgeRouter 的唯一开关，端点候选由插件运行时产出
 * - capabilities 为宽松能力集声明，未声明的能力宿主硬拒绝
 */
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const SEMVER_PATTERN = '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$'

const ManifestEntrySchema = Type.Object({
  path: Type.String({ minLength: 1, description: 'zip 内相对路径' }),
  sha256: Type.String({
    pattern: '^[0-9a-f]{64}$',
    description: '条目内容 sha256（小写十六进制）',
  }),
})

export const PluginManifestSchema = Type.Object({
  id: Type.String({
    pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
    description: '插件 ID，单段 kebab-case',
  }),
  name: Type.Optional(Type.String({ minLength: 1 })),
  version: Type.String({ pattern: SEMVER_PATTERN }),
  hostVersion: Type.String({ minLength: 1, description: '兼容宿主版本范围（semver range）' }),
  entries: Type.Object(
    {
      common: ManifestEntrySchema,
      web: Type.Optional(ManifestEntrySchema),
      android: Type.Optional(ManifestEntrySchema),
      macos: Type.Optional(ManifestEntrySchema),
      windows: Type.Optional(ManifestEntrySchema),
    },
    { additionalProperties: false },
  ),
  fallback: Type.Optional(ManifestEntrySchema),
  runtime: Type.Object(
    {
      rn: Type.String({ minLength: 1, description: 'React Native 版本范围（semver range）' }),
      hermes: Type.String({ minLength: 1, description: 'Hermes 引擎版本范围（semver range）' }),
      bytecode: Type.Integer({ minimum: 1, description: 'Hermes 字节码版本' }),
      cpu: Type.Array(Type.String(), { minItems: 1, description: '支持的 CPU 架构' }),
      compileOptions: Type.Record(Type.String(), Type.String(), { description: '编译选项摘要' }),
    },
    { additionalProperties: false },
  ),
  network: Type.Object(
    { multiEdge: Type.Boolean({ description: 'EdgeRouter 多端点分流开关' }) },
    { additionalProperties: false },
  ),
  capabilities: Type.Array(Type.String(), { description: '能力依赖声明（宽松集）' }),
})

export type PluginManifest = Static<typeof PluginManifestSchema>

export interface ManifestIssue {
  readonly path: string
  readonly message: string
}

export type ManifestValidation =
  | { readonly ok: true; readonly manifest: PluginManifest }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] }

/** 校验 manifest 结构与 semver range 合法性，返回判别联合结果。 */
export function validateManifest(value: unknown): ManifestValidation {
  if (!Value.Check(PluginManifestSchema, value)) {
    return {
      ok: false,
      issues: [...Value.Errors(PluginManifestSchema, value)].map(error => ({
        path: error.instancePath || '/',
        message: error.message,
      })),
    }
  }
  const issues: ManifestIssue[] = []
  for (const [path, range] of [
    ['/hostVersion', value.hostVersion],
    ['/runtime/rn', value.runtime.rn],
    ['/runtime/hermes', value.runtime.hermes],
  ] as const) {
    if (!validRange(range)) issues.push({ path, message: `不是合法 semver range：${range}` })
  }
  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, manifest: value }
}