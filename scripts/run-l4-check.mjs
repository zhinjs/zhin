#!/usr/bin/env node
/**
 * L4 全维度验收：编排 + 记忆 + full-bot 契约 + MCP 鉴权 + IM 适配器契约。
 * 不调用真实 LLM；实机平台项由 L4_SKIP_PLATFORM=1 跳过（CI 默认）。
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.L4_SKIP_PLATFORM) {
  process.env.L4_SKIP_PLATFORM = '1';
}

/** @type {string[]} */
const l4TestFiles = [
  'packages/im/agent/tests/orchestration-repository.test.ts',
  'packages/im/agent/tests/orchestration-dispatcher.test.ts',
  'packages/im/agent/tests/orchestration-e2e.test.ts',
  'packages/im/agent/tests/remote-loopback.test.ts',
  'packages/im/agent/tests/memory-entry.test.ts',
  'packages/host/mcp/tests/mesh-auth.test.ts',
  'examples/full-bot/tests/full-bot-l4-contract.test.ts',
  'examples/full-bot/tests/multimodal-peers-contract.test.ts',
  'packages/im/core/tests/multimodal-chain-contract.test.ts',
  'plugins/adapters/napcat/tests/l4-contract.test.ts',
  'plugins/adapters/kook/tests/l4-contract.test.ts',
];

console.log('Running L4 check (L4_SKIP_PLATFORM=%s)...\n', process.env.L4_SKIP_PLATFORM);
for (const file of l4TestFiles) {
  console.log(`  • ${file}`);
}

execSync(`pnpm vitest run ${l4TestFiles.map((f) => JSON.stringify(f)).join(' ')}`, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, L4_SKIP_PLATFORM: process.env.L4_SKIP_PLATFORM },
});

console.log('\nL4 check passed.\n');
