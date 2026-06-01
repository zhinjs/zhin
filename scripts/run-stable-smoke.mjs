#!/usr/bin/env node
/**
 * Stable 产品路径 smoke：Sandbox 入站链路 + Agent 核心单测 + minimal-bot 配置契约。
 * 不调用真实 LLM（无 API Key 要求）。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string[]} */
const stableTestFiles = [
  'plugins/adapters/sandbox/tests/integration.test.ts',
  'packages/agent/tests/ai/integration.test.ts',
  'packages/agent/tests/builtin/spawn-task-tool.test.ts',
  'packages/agent/tests/exec-policy.test.ts',
  'examples/minimal-bot/tests/stable-path.test.ts',
];

console.log('Running Stable smoke tests...\n');
for (const file of stableTestFiles) {
  console.log(`  • ${file}`);
}

execSync(`pnpm vitest run ${stableTestFiles.map((f) => JSON.stringify(f)).join(' ')}`, {
  cwd: repoRoot,
  stdio: 'inherit',
});

console.log('\nStable smoke passed.\n');
