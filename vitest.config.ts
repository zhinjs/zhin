import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    conditions: ['development'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/lib/**', '**/packages/satori/**'],
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    isolate: false,
    sequence: {
      hooks: 'list'
    },
    deps: {
      moduleDirectories: ['node_modules', 'basic/cli/node_modules', 'basic/logger/node_modules', 'basic/schema/node_modules', 'basic/database/node_modules'],
    }
  }
})
