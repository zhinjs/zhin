#!/usr/bin/env node
/**
 * 校验声明 aiOutboundExtensions 的 adapter 含 ai-outbound-contract 测试
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.join(repoRoot, 'plugins/adapters');

const entries = fs.readdirSync(adaptersDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const errors = [];

for (const name of entries) {
  const adapterPath = path.join(adaptersDir, name, 'src', 'adapter.ts');
  const contractTest = path.join(adaptersDir, name, 'tests', 'ai-outbound-contract.test.ts');
  if (!fs.existsSync(adapterPath)) continue;

  const src = fs.readFileSync(adapterPath, 'utf8');
  if (!src.includes('aiOutboundExtensions')) continue;

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
