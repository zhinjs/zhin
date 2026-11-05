import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['development'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/lib/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.tmp/**',
      '**/.vite-temp/**',
      'packages/im/agent/evals/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    /** 开启文件级隔离，避免 vi.spyOn / vi.mock 跨文件泄漏导致 flaky */
    isolate: true,
    sequence: {
      hooks: 'list',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: [
        'basic/*/src/**/*.ts',
        'packages/*/src/**/*.ts',
        'packages/*/*/src/**/*.ts',
        'plugins/*/*/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/lib/**', '**/dist/**'],
      thresholds: {
        lines: 45,
        branches: 35,
      },
    },
  },
  server: {
    deps: {
      moduleDirectories: [
        'node_modules',
        'examples/test-bot/node_modules',
        'basic/cli/node_modules',
        'basic/logger/node_modules',
        'basic/schema/node_modules',
        'basic/database/node_modules',
        'basic/schedule/node_modules',
      ],
    },
  },
})
