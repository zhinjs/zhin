#!/usr/bin/env node
/**
 * #735 配置面门禁：每个 ai.agent.* 开关（schema + ZhinAgentConfig）都必须登记在
 * docs/ai/default-behavior.md 与英文版的开关清单中，且非弃用开关数量不超过基线。
 * 新增开关时：登记清单、在 PR 中说明理由，必要时上调 BASELINE。
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

/** Includes recordRequestBodies: an explicit opt-out of the approved default-on local request recording. */
const BASELINE = 62;

function schemaAgentKeys() {
  const schema = JSON.parse(read('packages/im/runtime/src/host-config-schema.json'));
  const agent = schema.properties?.ai?.properties?.agent?.properties ?? {};
  return Object.keys(agent);
}

function interfaceKeys() {
  const src = read('packages/im/agent/src/config/zhin-agent-config.ts');
  const body = src.match(/export interface ZhinAgentConfig[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  return [...body.matchAll(/^ {2}(?:readonly )?([A-Za-z]+)\??:/gm)].map((m) => m[1]);
}

function inventory(rel) {
  const rows = new Map();
  for (const m of read(rel).matchAll(/^\| `([A-Za-z]+)` \| ([a-z-]+) \|/gm)) rows.set(m[1], m[2]);
  return rows;
}

const keys = new Set([...schemaAgentKeys(), ...interfaceKeys()]);
const errors = [];
for (const doc of ['docs/ai/default-behavior.md', 'docs/en/ai/default-behavior.md']) {
  const rows = inventory(doc);
  for (const key of keys) if (!rows.has(key)) errors.push(`${doc}: 缺少开关 ai.agent.${key}`);
  for (const key of rows.keys()) if (!keys.has(key)) errors.push(`${doc}: 清单含不存在的开关 ${key}`);
  const active = [...rows.values()].filter((d) => d !== 'deprecated').length;
  if (active > BASELINE) {
    errors.push(`${doc}: 非弃用开关 ${active} 个，超过基线 ${BASELINE}；请说明理由并上调 BASELINE`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`agent config inventory OK (${keys.size} switches)`);
