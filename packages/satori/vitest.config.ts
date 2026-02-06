import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
    // Exclude tests that cause resvg to crash
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/border-background.test.ts',
      '**/boundary-conditions.test.ts',
      '**/layout.test.ts',
      '**/text.test.ts',
    ],
  },
  resolve: {
    alias: [
      {
        find: '@yoga',
        replacement: path.resolve(__dirname, 'src', 'yoga', 'yoga-prebuilt.ts'),
      },
    ],
  },
})
