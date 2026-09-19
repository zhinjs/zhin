#!/usr/bin/env node
/**
 * Harness: runtime turn paths resolve transport models through their owner's
 * LlmApiRuntime. They must not import the ambiguous discovery helper getModel.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoots = ['packages/im/agent/src', 'packages/im/zhin/src'];
const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', 'init']);

function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walkTs(file, acc);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx'))
      && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')) acc.push(file);
  }
}

function findAmbiguousImports(source) {
  const hits = [];
  const importBlock = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s*from\s+['"]@zhin\.js\/ai['"]/g;
  let match;
  while ((match = importBlock.exec(source)) !== null) {
    if (!/\bgetModel\b/.test(match[1])) continue;
    hits.push({
      line: source.slice(0, match.index).split(/\r?\n/).length,
      text: match[0].replace(/\s+/g, ' ').trim(),
    });
  }
  return hits;
}

const violations = [];
for (const root of scanRoots) {
  const files = [];
  walkTs(path.join(repoRoot, root), files);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const hit of findAmbiguousImports(source)) {
      violations.push({ file: path.relative(repoRoot, file), ...hit });
    }
  }
}

if (violations.length > 0) {
  console.error('Harness LLM runtime boundary check: FAILED\n');
  console.error('Resolve transport models through the owning LlmApiRuntime; do not import getModel.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
  }
  process.exit(1);
}

console.log('Harness LLM runtime boundary check: OK.');
