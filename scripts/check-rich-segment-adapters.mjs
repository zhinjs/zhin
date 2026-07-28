#!/usr/bin/env node
/**
 * 校验 IM adapter 的 defineAdapter segments.outboundMedia 声明（富媒体段出站协商）。
 * 探测点：plugins/adapters/<name>/adapters/*.ts（defineAdapter 约定入口；
 * 旧探测点 src/adapter.ts 与 outboundRichSegmentPolicy 已不存在）。
 * 契约：声明 `segments: { outboundMedia: ['url'|'path'|'base64'|'upload', ...] }`；
 * 未迁移的 adapter 列入 OUTBOUND_MEDIA_PENDING 豁免（Wave 2 渐进收敛）。
 * 用法：node scripts/check-rich-segment-adapters.mjs [adaptersRoot]（测试可传 fixture 目录）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adaptersDir = path.resolve(process.argv[2] ?? path.join(repoRoot, 'plugins/adapters'));

/** 尚未声明 segments.outboundMedia 的 adapter（Wave 2 迁移时声明并从此名单移除） */
const OUTBOUND_MEDIA_PENDING = new Set([
  'dingtalk', 'discord', 'email', 'github', 'kook', 'line',
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
    /\boutboundMedia\s*:/u.test(fs.readFileSync(file, 'utf8')));
  if (!declared && !OUTBOUND_MEDIA_PENDING.has(name)) {
    errors.push(`${name}: adapters/*.ts 未声明 segments.outboundMedia（或加入 OUTBOUND_MEDIA_PENDING 豁免）`);
  }
  if (declared && OUTBOUND_MEDIA_PENDING.has(name)) {
    errors.push(`${name}: 已声明 segments.outboundMedia，请从 OUTBOUND_MEDIA_PENDING 豁免名单移除`);
  }
}

if (errors.length > 0) {
  console.error('check:rich-segments failed:\n');
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}

console.log(
  `check:rich-segments passed (${entries.length} adapter dirs; pending: ${OUTBOUND_MEDIA_PENDING.size}).\n`,
);
