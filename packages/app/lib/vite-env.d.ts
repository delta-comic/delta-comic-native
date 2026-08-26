/** Vite 静态资源导入的模块声明。 */
declare module '*.css'
declare module '*?url' {
  const url: string
  export default url
}
