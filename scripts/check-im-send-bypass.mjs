#!/usr/bin/env node
/**
 * Harness：检测插件/业务路径是否绕过 Adapter.sendMessage 链直调 bot.$sendMessage。
 * 适配器包内 Bot 实现中的 $sendMessage 定义不在扫描范围内。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const scanRoots = [
  'packages/zhin/src',
  'packages/agent/src',
  'plugins/features',
  'plugins/services',
  'plugins/utils',
  'plugins/games',
];

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git']);

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !p.includes(`${path.sep}tests${path.sep}`)) {
      acc.push(p);
    }
  }
}

const botSendRe = /\bbot\.\$sendMessage\s*\(/g;

let violations = [];

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    if (!botSendRe.test(txt)) {
      botSendRe.lastIndex = 0;
      continue;
    }
    botSendRe.lastIndex = 0;
    const lines = txt.split(/\r?\n/);
    lines.forEach((line, i) => {
      botSendRe.lastIndex = 0;
      if (botSendRe.test(line)) {
        violations.push({ file: path.relative(repoRoot, file), line: i + 1, text: line.trim() });
      }
    });
  }
}

if (violations.length) {
  console.error('Harness check: direct bot.$sendMessage() bypasses Adapter.sendMessage / before.sendMessage chain:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error('\nUse adapter.sendMessage(SendOptions) or message.$reply(...) instead.\n');
  process.exit(1);
}

console.log('Harness send-path check: OK (no bot.$sendMessage in scanned plugin paths).');
