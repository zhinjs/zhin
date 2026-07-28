#!/usr/bin/env node
/**
 * 校验声明 aiOutboundExtensions 的 adapter 含 ai-outbound-contract 测试。
 * 探测点：plugins/adapters/<name>/adapters/*.ts（defineAdapter 约定入口；
 * 旧探测点 src/adapter.ts 已不存在）。
 * 用法：node scripts/check-ai-outbound-adapters.mjs [adaptersRoot]（测试可传 fixture 目录）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'plugins/adapters'));

const entries = fs.readdirSync(adaptersDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const errors = [];

for (const name of entries) {
  const entryDir = path.join(adaptersDir, name, 'adapters');
  if (!fs.existsSync(entryDir)) continue;
  const files = fs.readdirSync(entryDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(entryDir, f));
  if (files.length === 0) continue;

  const src = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  if (!src.includes('aiOutboundExtensions')) continue;

  const contractTest = path.join(adaptersDir, name, 'tests', 'ai-outbound-contract.test.ts');
  if (!src.includes('aiOutboundCapabilities')) {
    errors.push(`${name}: 声明 aiOutboundExtensions 但缺少 aiOutboundCapabilities`);
  }
  if (!fs.existsSync(contractTest)) {
    errors.push(`${name}: 缺少 tests/ai-outbound-contract.test.ts`);
  }
}

if (errors.length > 0) {
  console.error('check:ai-outbound failed:\n');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(`check:ai-outbound passed (${entries.length} adapter dirs scanned).\n`);
