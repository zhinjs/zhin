import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import rootConfig from '../../../../../vitest.config.js';

/** `pnpm eval:nightly`: real-model capability matrix. Never part of the PR gate. */
export default defineConfig({
  ...rootConfig,
  root: fileURLToPath(new URL('../../../../../', import.meta.url)),
  test: {
    ...rootConfig.test,
    include: ['packages/im/agent/evals/nightly/nightly.run.ts'],
    testTimeout: 30 * 60_000,
  },
});
