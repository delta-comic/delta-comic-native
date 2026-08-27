import { uniwind } from 'uniwind/vite'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  // vitest（node 环境）不加载样式管线
  plugins: process.env.VITEST === undefined ? [uniwind({ cssEntryFile: 'lib/global.css' })] : [],
  // workspace 内上游包位于项目根之外，rolldown 读不到其 tsconfig，显式声明 JSX 形态
  esbuild: { jsx: 'automatic', jsxImportSource: 'react', include: /\.(ts|tsx|js|jsx)$/ },
  // react 的 jsx-runtime 在 exports 映射里默认解析到 CJS 文件（jsx-runtime.js），
  // 显式预打包成带具名导出的 ESM，否则 dev 下 `import { jsx }` 报缺具名导出。
  optimizeDeps: {
    include: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    // expo-modules-core 的类型声明 stub 无法被 rolldown 静态分析，走变换管线而非预打包
    exclude: ['expo-modules-core'],
  },
  resolve: {
    alias: {
      // Web 端以 react-native-web 承载 RN 组件
      'react-native': 'react-native-web',
      // screens 无平台无关产物，Web 以空实现替代（native-stack 降级）
      'react-native-screens': new URL('./lib/web/screens-stub.ts', import.meta.url).pathname,
      'react-native-safe-area-context': new URL('./lib/web/safe-area-stub.tsx', import.meta.url)
        .pathname,
      // expo-image 为 RN 原生包，Web 用 RNW Image 替身承载
      'expo-image': new URL('./lib/web/expo-image-stub.tsx', import.meta.url).pathname,
    },
  },
})