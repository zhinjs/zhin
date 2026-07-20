#!/usr/bin/env node
/**
 * Harness：usePlugin() 须在模块顶层调用（AsyncLocalStorage 上下文）。
 * 启发式：出现 usePlugin( 时花括号深度须为 0（忽略字符串内的括号误差不计）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scanRoots = [
  'plugins/adapters',
  'plugins/features',
  'plugins/utils',
  'plugins/games',
  'examples/minimal-bot',
  'examples/test-bot',
];

/** @param {string} line */
function lineHasUsePluginCall(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) return false;
  const noStrings = line.replace(
    /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g,
    '',
  );
  return /\busePlugin\s*\(/.test(noStrings);
}

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests']);

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if (
      (name.endsWith('.ts') || name.endsWith('.tsx'))
      && !name.endsWith('.test.ts')
      && !name.endsWith('.spec.ts')
    ) {
      acc.push(p);
    }
  }
}

/** @type {{ file: string, line: number, text: string }[]} */
const violations = [];

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    if (!/\busePlugin\s*\(/.test(txt)) continue;
    let depth = 0;
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (lineHasUsePluginCall(line) && depth > 0) {
        violations.push({
          file: path.relative(repoRoot, file),
          line: i + 1,
          text: line.trim(),
        });
      }
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('usePlugin() must be called at module top-level:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

console.log('check:use-plugin-top-level passed.');
