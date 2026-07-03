#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(root, 'tests/snapshots/api-surface.json');

const targets = {
  'zhin.js': 'packages/im/zhin/src/index.ts',
  'zhin.js/agent': 'packages/im/zhin/src/agent.ts',
  '@zhin.js/agent': 'packages/im/agent/src/index.ts',
  '@zhin.js/core': 'packages/im/core/src/index.ts',
};

function normalize(statement) {
  return statement
    .replace(/\s+/g, ' ')
    .replace(/\s*([{},;])\s*/g, '$1')
    .trim();
}

function collectExportStatements(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const exports = [];
  let buffer = '';
  let collecting = false;
  let braceDepth = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!collecting && !line.startsWith('export ')) continue;
    collecting = true;
    buffer += `${line} `;
    braceDepth += (line.match(/{/g) ?? []).length;
    braceDepth -= (line.match(/}/g) ?? []).length;
    if (
      braceDepth <= 0
      && (line.includes(' from ') || line.endsWith(';') || line.endsWith('}'))
    ) {
      exports.push(normalize(buffer));
      buffer = '';
      collecting = false;
      braceDepth = 0;
    }
  }
  if (buffer.trim()) exports.push(normalize(buffer));
  return exports.sort();
}

function buildSnapshot() {
  return Object.fromEntries(Object.entries(targets).map(([name, rel]) => {
    const filePath = path.join(root, rel);
    return [name, collectExportStatements(filePath)];
  }));
}

const current = buildSnapshot();

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${path.relative(root, snapshotPath)}.`);
  process.exit(0);
}

const expected = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

try {
  assert.deepEqual(current, expected);
  console.log('API surface check passed.');
} catch (error) {
  console.error('API surface changed. Review public exports, then run:');
  console.error('  node scripts/check-api-surface.mjs --update');
  throw error;
}
