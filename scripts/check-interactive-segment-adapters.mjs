#!/usr/bin/env node
/**
 * 校验各 IM adapter 声明 interactivePolicy 且含 interactive-segment-outbound-contract 测试
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
  const sandboxWs = path.join(adaptersDir, name, 'src', 'sandbox-ws.ts');
  const contractTest = path.join(adaptersDir, name, 'tests', 'interactive-segment-outbound-contract.test.ts');

  const adapterFile = fs.existsSync(adapterPath) ? adapterPath : (fs.existsSync(sandboxWs) ? sandboxWs : null);
  if (!adapterFile) continue;

  const src = fs.readFileSync(adapterFile, 'utf8');
  if (!src.includes('interactivePolicy')) {
    errors.push(`${name}: ${path.basename(adapterFile)} 缺少 interactivePolicy`);
  }
  if (!fs.existsSync(contractTest)) {
    errors.push(`${name}: 缺少 tests/interactive-segment-outbound-contract.test.ts`);
  }
}

if (errors.length > 0) {
  console.error('check:interactive-segments failed:\n');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(`check:interactive-segments passed (${entries.length} adapter dirs scanned).\n`);
