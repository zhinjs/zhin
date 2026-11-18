import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import rootConfig from '../../../../vitest.config.js';

/**
 * `pnpm eval:agent`: the eval cases plus the framework self-tests.
 * Reuses the root resolution/setup but replaces `include`
 * (mergeConfig would concatenate include with the root glob and run the
 * whole suite).
 *
 * Root `vitest.config.ts` excludes `packages/im/agent/evals/**` so scripted and
 * live evals stay out of `pnpm test`. Vitest applies exclude before include, so
 * spreading that list would hide every file this config includes. Drop that one
 * pattern here and keep every other root exclude.
 */
const PR_GATE_EVAL_EXCLUDE = 'packages/im/agent/evals/**';
const rootExclude = rootConfig.test?.exclude ?? [];
if (!Array.isArray(rootExclude)) {
  throw new Error('Root Vitest exclude must be a string array so agent evals can drop the evals pattern');
}

export default defineConfig({
  ...rootConfig,
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  test: {
    ...rootConfig.test,
    include: ['packages/im/agent/evals/**/*.eval.ts', 'packages/im/agent/evals/**/*.test.ts'],
    exclude: rootExclude.filter((pattern) => pattern !== PR_GATE_EVAL_EXCLUDE),
  },
});
