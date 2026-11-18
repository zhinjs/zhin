import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import rootConfig from '../../../../../vitest.config.js';

/**
 * `pnpm eval:nightly`: real-model capability matrix. Never part of the PR gate.
 *
 * Root `vitest.config.ts` excludes `packages/im/agent/evals/**` so scripted and
 * live evals stay out of `pnpm test`. Vitest applies exclude before include, so
 * spreading that list hides `nightly.run.ts` even though it is the only include.
 * Drop that one pattern here and keep every other root exclude.
 */
const PR_GATE_EVAL_EXCLUDE = 'packages/im/agent/evals/**';
const rootExclude = rootConfig.test?.exclude ?? [];
if (!Array.isArray(rootExclude)) {
  throw new Error('Root Vitest exclude must be a string array so nightly can drop the evals pattern');
}

export default defineConfig({
  ...rootConfig,
  root: fileURLToPath(new URL('../../../../../', import.meta.url)),
  test: {
    ...rootConfig.test,
    include: ['packages/im/agent/evals/nightly/nightly.run.ts'],
    exclude: rootExclude.filter((pattern) => pattern !== PR_GATE_EVAL_EXCLUDE),
    testTimeout: 30 * 60_000,
    // Real API on a 15 RPM free tier: one file, one test at a time (the runner and
    // RateLimitedCompletionPort serialize the requests inside it).
    fileParallelism: false,
    maxConcurrency: 1,
    sequence: { ...rootConfig.test?.sequence, concurrent: false },
  },
});
