#!/usr/bin/env node
/**
 * L4-CI：确定性子集（编排 / 记忆 / full-bot 契约），适合 PR 门禁。
 * 全量文件列表见 sibling `run-l4-check.mjs`（nightly）；本列表须为后者的真子集，改全量时请同步审阅本文件。
 * 不调用真实 LLM；实机平台项不在此列表。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!process.env.L4_SKIP_PLATFORM) {
  process.env.L4_SKIP_PLATFORM = '1';
}

/** @type {string[]} */
const l4CiTestFiles = [
  'packages/im/agent/tests/orchestration-dispatcher.test.ts',
  'packages/im/agent/tests/orchestrator/executor-contract.test.ts',
  'packages/im/agent/tests/memory-entry.test.ts',
  'packages/host/mcp/tests/runtime.test.ts',
  'packages/host/a2a/tests/runtime.test.ts',
  'basic/cli/tests/plugin-runtime/database-host.test.ts',
  'packages/im/agent/tests/plugin-runtime/agent-runtime.test.ts',
  'packages/im/tool/tests/tool.test.ts',
  'examples/full-bot/tests/full-bot-l4-contract.test.ts',
  'examples/full-bot/tests/provider-gateway-contract.test.ts',
  'examples/full-bot/tests/multimodal-peers-contract.test.ts',
  'examples/qq-games-bot/tests/runtime-contract.test.ts',
  'packages/im/core/tests/multimodal-chain-contract.test.ts',
];

// 防再犯：列出的测试文件必须真实存在，否则 vitest 会静默把缺失路径当过滤器跳过
const missingFiles = l4CiTestFiles.filter((f) => !fs.existsSync(path.join(repoRoot, f)));
if (missingFiles.length > 0) {
  console.error('L4-CI test file(s) not found:\n' + missingFiles.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}

console.log('Running L4-CI check (deterministic subset, L4_SKIP_PLATFORM=%s)...\n', process.env.L4_SKIP_PLATFORM);
for (const file of l4CiTestFiles) {
  console.log(`  • ${file}`);
}

execSync(`pnpm vitest run ${l4CiTestFiles.map((f) => JSON.stringify(f)).join(' ')}`, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, L4_SKIP_PLATFORM: process.env.L4_SKIP_PLATFORM },
});

execSync('pnpm check:orchestration-ssot', {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, L4_SKIP_PLATFORM: process.env.L4_SKIP_PLATFORM },
});

console.log('\nL4-CI check passed.\n');
