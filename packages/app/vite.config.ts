import { uniwind } from 'uniwind/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  // vitest（node 环境）不加载样式管线
  plugins: process.env.VITEST === undefined ? [uniwind({ cssEntryFile: 'lib/global.css' })] : [],
  // workspace 内上游包位于项目根之外，rolldown 读不到其 tsconfig，显式声明 JSX 形态
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
    include: /\.(ts|tsx|js|jsx)$/,
  },
  resolve: {
    alias: {
      // Web 端以 react-native-web 承载 RN 组件
      'react-native': 'react-native-web',
      // screens 无平台无关产物，Web 以空实现替代（native-stack 降级）
      'react-native-screens': new URL('./lib/web/screens-stub.ts', import.meta.url).pathname,
      'react-native-safe-area-context': new URL('./lib/web/safe-area-stub.tsx', import.meta.url).pathname,
    },
  },
})