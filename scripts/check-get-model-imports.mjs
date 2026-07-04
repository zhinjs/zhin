#!/usr/bin/env node
/**
 * Harness: disambiguate getModel imports in agent/zhin runtime code.
 * Agent turn paths must use getLlmTransportModel (pi transport), not discovery getModel.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scanRoots = [
  'packages/im/agent/src',
  'packages/im/zhin/src',
];

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', 'init']);

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

const importFromAiRe = /from\s+['"]@zhin\.js\/ai['"]/;
const bareGetModelImportRe = /\bgetModel\b/;

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!importFromAiRe.test(line) || !bareGetModelImportRe.test(line)) continue;
      if (/\bgetLlmTransportModel\b/.test(line)) continue;
      if (line.trim().startsWith('//')) continue;
      violations.push({
        file: relFile,
        line: i + 1,
        text: line.trim(),
      });
    }
  }
}

if (violations.length) {
  console.error('Harness getModel import check: FAILED\n');
  console.error('Use getLlmTransportModel from @zhin.js/ai for LLM transport (not ModelRegistry.getModel / discovery).\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

console.log('Harness getModel import check: OK.');
