#!/usr/bin/env node
/**
 * 校验 IM adapter 的 defineAdapter segments 声明（全平台消息段统一出入站通道）。
 * 探测点：plugins/adapters/<name>/adapters/*.ts（defineAdapter 约定入口；
 * 旧探测点 src/adapter.ts 已不存在）。
 * 契约：adapters/*.ts 中声明 `segments: { ... }`；未迁移的 adapter 列入
 * SEGMENTS_PENDING 豁免（Wave 2 迁移时声明并移出豁免，名单收敛到空）。
 * 用法：node scripts/check-segment-adapters.mjs [adaptersRoot]（测试可传 fixture 目录）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'plugins/adapters'));

/** 尚未声明 segments 的 adapter（Wave 2 迁移时声明并从此名单移除） */
const SEGMENTS_PENDING = new Set([
  'dingtalk', 'discord', 'email', 'github', 'kook', 'line', 'milky', 'qq',
  'sandbox', 'satori', 'slack', 'telegram', 'weixin-ilink',
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
    /\bsegments\s*:/u.test(fs.readFileSync(file, 'utf8')));
  if (!declared && !SEGMENTS_PENDING.has(name)) {
    errors.push(`${name}: adapters/*.ts 未声明 defineAdapter segments（或加入 SEGMENTS_PENDING 豁免）`);
  }
  if (declared && SEGMENTS_PENDING.has(name)) {
    errors.push(`${name}: 已声明 segments，请从 SEGMENTS_PENDING 豁免名单移除`);
  }
}

if (errors.length > 0) {
  console.error('check:segments failed:\n');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(
  `check:segments passed (${entries.length} adapter dirs; pending: ${SEGMENTS_PENDING.size}).\n`,
);
