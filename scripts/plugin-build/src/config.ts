import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

/**
 * 插件包根目录的 plugin.build.json 配置。
 * 描述 manifest 元数据与各平台构建入口；最终以 validateManifest 校验结果为准。
 */
const BuildEntrySchema = Type.Object({
  /** 源入口文件（相对插件目录）。 */
  entry: Type.String({ minLength: 1 }),
  /** 构建输出目录（相对插件目录），默认按平台约定。 */
  outDir: Type.Optional(Type.String()),
})

export const PluginBuildConfigSchema = Type.Object({
  id: Type.String({ pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' }),
  name: Type.Optional(Type.String({ minLength: 1 })),
  version: Type.String({ minLength: 1 }),
  hostVersion: Type.String({ minLength: 1 }),
  capabilities: Type.Array(Type.String()),
  network: Type.Object({ multiEdge: Type.Boolean() }, { additionalProperties: false }),
  runtime: Type.Object(
    {
      rn: Type.String({ minLength: 1 }),
      hermes: Type.String({ minLength: 1 }),
      bytecode: Type.Integer({ minimum: 1 }),
      cpu: Type.Array(Type.String(), { minItems: 1 }),
      compileOptions: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: false },
  ),
  dependencies: Type.Optional(Type.Array(Type.String())),
  /** hermesc 可执行文件路径；缺省时跳过字节码发射。 */
  hermesc: Type.Optional(Type.String()),
  entries: Type.Object(
    {
      common: BuildEntrySchema,
      web: Type.Optional(BuildEntrySchema),
      android: Type.Optional(BuildEntrySchema),
      macos: Type.Optional(BuildEntrySchema),
      windows: Type.Optional(BuildEntrySchema),
    },
    { additionalProperties: false },
  ),
})

export type PluginBuildConfig = Static<typeof PluginBuildConfigSchema>

export class BuildConfigError extends Error {
  readonly issues: readonly { path: string; message: string }[]

  constructor(issues: readonly { path: string; message: string }[]) {
    super(`plugin.build.json 校验失败：\n${issues.map(i => `${i.path}: ${i.message}`).join('\n')}`)
    this.name = 'BuildConfigError'
    this.issues = issues
  }
}

/** 解析并校验 plugin.build.json 配置对象。 */
export function parseBuildConfig(value: unknown): PluginBuildConfig {
  if (!Value.Check(PluginBuildConfigSchema, value)) {
    throw new BuildConfigError(
      [...Value.Errors(PluginBuildConfigSchema, value)].map(error => ({
        path: error.instancePath || '/',
        message: error.message,
      })),
    )
  }
  return value
}