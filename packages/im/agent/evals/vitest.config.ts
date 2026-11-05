import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import rootConfig from '../../../../vitest.config.js';

/**
 * `pnpm eval:agent`: the eval cases plus the framework self-tests.
 * Reuses the root resolution/setup but replaces `include` / `exclude`
 * (mergeConfig would concatenate include with the root glob and run the
 * whole suite; the root exclude also drops this tree).
 */
export default defineConfig({
  ...rootConfig,
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    ...rootConfig.test,
    include: ['packages/im/agent/evals/**/*.eval.ts', 'packages/im/agent/evals/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/lib/**',
      '**/dist/**',
      '**/.claude/**',
      '**/.tmp/**',
      '**/.vite-temp/**',
    ],
  },
});
