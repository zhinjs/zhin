import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import rootConfig from '../../../../vitest.config.js';

/**
 * `pnpm eval:agent`: the eval cases plus the framework self-tests.
 * Reuses the root resolution/setup but replaces `include` (mergeConfig would
 * concatenate it with the root glob and run the whole suite).
 */
export default defineConfig({
  ...rootConfig,
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    ...rootConfig.test,
    include: ['packages/im/agent/evals/**/*.eval.ts', 'packages/im/agent/evals/**/*.test.ts'],
  },
});
