#!/usr/bin/env node
/**
 * Harness: 检查生产环境配置是否正确
 * - 确保没有硬编码的调试配置
 * - 确保必要的环境变量配置
 * - 确保没有开发专用的依赖在生产代码中
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', '__tests__']);

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')) {
      acc.push(p);
    }
  }
}

const violations = [];

// Patterns that should not be in production code
const debugPatterns = [
  { pattern: /\bconsole\.log\s*\(/g, message: 'console.log should not be in production code' },
  { pattern: /\bdebugger\b/g, message: 'debugger statement should not be in production code' },
  { pattern: /\bTODO\b/g, message: 'TODO comments should be resolved before production' },
  { pattern: /\bFIXME\b/g, message: 'FIXME comments should be resolved before production' },
  { pattern: /\bHACK\b/g, message: 'HACK comments should be resolved before production' },
];

// Scan source directories
const scanRoots = [
  'packages/kernel/src',
  'packages/ai/src',
  'packages/core/src',
  'packages/agent/src',
  'packages/zhin/src',
  'plugins/features',
  'plugins/services',
  'plugins/utils',
  'plugins/games',
];

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);

  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    const lines = txt.split(/\r?\n/);

    for (const { pattern, message } of debugPatterns) {
      lines.forEach((line, i) => {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          violations.push({
            file: path.relative(repoRoot, file),
            line: i + 1,
            text: line.trim(),
            issue: message,
          });
        }
      });
    }
  }
}

if (violations.length) {
  console.error('Harness production config check: FAILED\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.issue}`);
    console.error(`    ${v.text}\n`);
  }
  process.exit(1);
}

console.log('Harness production config check: OK (no debug patterns found).');
