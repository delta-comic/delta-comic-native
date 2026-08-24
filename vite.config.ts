import { resolve } from 'node:path'

import { defineConfig } from 'vite-plus'
import type { OxfmtConfig } from 'vite-plus/fmt'
import type { OxlintConfig } from 'vite-plus/lint'

import fmt from './.oxfmtrc.json' with { type: 'json' }
import lint from './.oxlintrc.json' with { type: 'json' }

const lintConfig = lint as OxlintConfig
const uiTailwindConfigPath = resolve(import.meta.dirname, 'packages/ui/src/index.css')

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
    '*.{ts,tsx,mts,js,jsx,mjs,html,md,json,yaml,toml}': 'vp exec cspell --no-must-find-files',
  },
  fmt: fmt as OxfmtConfig,
  lint: {
    ...lintConfig,
    settings: { ...lintConfig.settings, tailwindcss: { cssConfigPath: uiTailwindConfigPath } },
  },
  run: {
    cache: { tasks: true, scripts: false },
    tasks: {
      'release:preview': { command: 'node ./script/release-branches.mts preview', cache: false },
      'release:preview:dry-run': {
        command: 'node ./script/release-branches.mts preview --dry-run',
        cache: false,
      },
      'release:stable': { command: 'node ./script/release-branches.mts stable', cache: false },
      'release:stable:dry-run': {
        command: 'node ./script/release-branches.mts stable --dry-run',
        cache: false,
      },
      'typecheck': { command: 'vp run -r typecheck', dependsOn: ['lib-build'], output: [] },
    },
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
      ],
      exclude: [
      ],
      thresholds: { lines: 60, functions: 60, branches: 55, statements: 60 },
    },
    exclude: ['**/node_modules/**', '**/.git/**', '.agents/**'],
    projects: [
      { test: { name: 'root', environment: 'node', include: ['script/test/**/*.test.ts'] } },
      
    ],
  },
})