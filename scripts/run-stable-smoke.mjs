#!/usr/bin/env node
/**
 * Stable 产品路径 smoke：Plugin Runtime IM 纵向链路 + 平台/Agent 核心单测。
 * 不调用真实 LLM（无 API Key 要求）。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const stableTestFiles = [
  'packages/im/adapter/tests/adapter.test.ts',
  'packages/im/command/tests/command.test.ts',
  'packages/im/component/tests/component.test.ts',
  'packages/im/middleware/tests/middleware.test.ts',
  'packages/im/core/tests/plugin-runtime/im-runtime.test.ts',
  'examples/minimal-bot/tests/stable-path.test.ts',
];

console.log('Running Stable smoke tests...\n');
for (const file of stableTestFiles) {
  console.log(`  • ${file}`);
}

execSync(`pnpm vitest run ${stableTestFiles.map((f) => JSON.stringify(f)).join(' ')}`, {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-strip-types']
      .filter(Boolean)
      .join(' '),
  },
  stdio: 'inherit',
});

console.log('\nStable smoke passed.\n');
