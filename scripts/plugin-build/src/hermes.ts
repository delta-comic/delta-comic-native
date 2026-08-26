import { execFileSync } from 'node:child_process'

export interface BytecodeOptions {
  /** hermesc 可执行文件路径。 */
  hermesc: string
  /** 输入 JS bundle 路径。 */
  input: string
  /** 输出 .hbc 路径。 */
  output: string
}

export type CommandRunner = (file: string, args: readonly string[]) => void

const defaultRunner: CommandRunner = (file, args) => {
  execFileSync(file, [...args], { stdio: 'inherit' })
}

/**
 * 用 hermesc 将 JS bundle 编译为 Hermes 字节码。
 * hermesc 与执行器均可注入（测试用 fake runner 模拟产物）。
 */
export function emitBytecode(options: BytecodeOptions, run: CommandRunner = defaultRunner): void {
  run(options.hermesc, ['-emit-binary', '-out', options.output, options.input])
}