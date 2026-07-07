#!/usr/bin/env node
/**
 * 校验 IM adapter segment-mapper 契约。
 * #550：仅 sandbox 必须达标；其余 adapter 在 pending 白名单内。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.join(repoRoot, 'plugins/adapters');

/** 必须含 segment-mapper + segment-contract.test.ts */
const REQUIRED_ADAPTERS = new Set(['sandbox']);

/** 尚未迁移 segment-mapper 的 adapter（不报错） */
const PENDING_ADAPTERS = new Set([
  'dingtalk',
  'discord',
  'email',
  'github',
  'icqq',
  'kook',
  'lark',
  'line',
  'milky',
  'napcat',
  'onebot11',
  'onebot12',
  'process',
  'qq',
  'satori',
  'slack',
  'telegram',
  'wechat-mp',
  'wecom',
  'weixin-ilink',
]);

const entries = fs.readdirSync(adaptersDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const errors = [];

for (const name of entries) {
  const adapterPath = path.join(adaptersDir, name, 'src', 'adapter.ts');
  const sandboxWs = path.join(adaptersDir, name, 'src', 'sandbox-ws.ts');
  if (!fs.existsSync(adapterPath) && !fs.existsSync(sandboxWs)) continue;
  if (PENDING_ADAPTERS.has(name)) continue;

  const mapperPath = path.join(adaptersDir, name, 'src', 'segment-mapper.ts');
  const contractTest = path.join(adaptersDir, name, 'tests', 'segment-contract.test.ts');

  if (!fs.existsSync(mapperPath)) {
    errors.push(`${name}: 缺少 src/segment-mapper.ts（或加入 PENDING_ADAPTERS）`);
  }
  if (!fs.existsSync(contractTest)) {
    errors.push(`${name}: 缺少 tests/segment-contract.test.ts`);
  }

  if (REQUIRED_ADAPTERS.has(name) && errors.length) {
    // keep errors for required adapters
  }
}

if (errors.length > 0) {
  console.error('check:segments failed:\n');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(
  `check:segments passed (${entries.length} adapter dirs; required: ${[...REQUIRED_ADAPTERS].join(', ')}; pending: ${PENDING_ADAPTERS.size}).\n`,
);
