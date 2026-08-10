#!/usr/bin/env node
/**
 * Harness：usePlugin() 已删除——禁止在插件/示例源码中出现任何 usePlugin 调用。
 * 忽略注释行和字符串内容。
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
  'plugins/services',
  'examples/minimal-bot',
  'examples/test-bot',
  'examples/full-bot',
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
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lineHasUsePluginCall(lines[i])) {
        violations.push({
          file: path.relative(repoRoot, file),
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('usePlugin() has been removed — no calls allowed in plugin/example source:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

console.log('check:use-plugin-top-level passed.');
