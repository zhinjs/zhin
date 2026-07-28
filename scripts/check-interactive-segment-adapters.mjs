#!/usr/bin/env node
/**
 * 校验 IM adapter 的 defineAdapter segments.interactive 声明（交互段出站协商）。
 * 探测点：plugins/adapters/<name>/adapters/*.ts（defineAdapter 约定入口；
 * 旧探测点 src/adapter.ts / src/sandbox-ws.ts 与 interactivePolicy 已不存在）。
 * 契约：声明 `segments: { interactive: 'native' | 'text' }`；
 * 未迁移的 adapter 列入 INTERACTIVE_PENDING 豁免（Wave 2 渐进收敛）。
 * 用法：node scripts/check-interactive-segment-adapters.mjs [adaptersRoot]（测试可传 fixture 目录）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'plugins/adapters'));

/** 尚未声明 segments.interactive 的 adapter（Wave 2 迁移时声明并从此名单移除） */
const INTERACTIVE_PENDING = new Set([
  'dingtalk', 'discord', 'email', 'github', 'kook', 'lark', 'line',
  'milky', 'qq', 'sandbox', 'satori',
  'slack', 'telegram', 'weixin-ilink',
]);

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

  const declared = files.some((file) =>
    /\binteractive\s*:/u.test(fs.readFileSync(file, 'utf8')));
  if (!declared && !INTERACTIVE_PENDING.has(name)) {
    errors.push(`${name}: adapters/*.ts 未声明 segments.interactive（或加入 INTERACTIVE_PENDING 豁免）`);
  }
  if (declared && INTERACTIVE_PENDING.has(name)) {
    errors.push(`${name}: 已声明 segments.interactive，请从 INTERACTIVE_PENDING 豁免名单移除`);
  }
}

if (errors.length > 0) {
  console.error('check:interactive-segments failed:\n');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(
  `check:interactive-segments passed (${entries.length} adapter dirs; pending: ${INTERACTIVE_PENDING.size}).\n`,
);
