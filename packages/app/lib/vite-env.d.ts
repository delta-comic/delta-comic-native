/** Vite 静态资源导入的模块声明。 */
declare module '*.css'
declare module '*?url' {
  const url: string
  export default url
}

interface ImportMetaEnv {
  /** dcd 注入的 ws 配对地址（含实时 token）。 */
  readonly VITE_DELTA_DEV_MCP_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}