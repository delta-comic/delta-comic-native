import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['lib/index.ts'],
    outDir: 'dist',
    format: 'esm',
    dts: true,
    platform: 'neutral',
    target: 'esnext',
    sourcemap: true,
    treeshake: true,
    clean: true,
  },
})