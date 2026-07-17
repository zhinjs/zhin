#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const nextRoot = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(nextRoot, '../..');
const snapshotPath = path.join(nextRoot, 'api-surface.json');
const migratedRoots = [
  ['plugin-runtime', 'packages/im/plugin-runtime/src'],
  ['feature-kit', 'packages/im/feature-kit/src'],
  ['adapter', 'packages/im/adapter/src'],
  ['command', 'packages/im/command/src'],
  ['component', 'packages/im/component/src'],
  ['middleware', 'packages/im/middleware/src'],
  ['core/runtime', 'packages/im/core/src/plugin-runtime/im'],
];

function normalize(statement) {
  return statement.replace(/\s+/gu, ' ').replace(/\s*([{},;])\s*/gu, '$1').trim();
}

function exportsFrom(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/gu);
  const exports = [];
  let buffer = '';
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!buffer && !line.startsWith('export ')) continue;
    buffer += `${line} `;
    depth += (line.match(/\{/gu) ?? []).length - (line.match(/\}/gu) ?? []).length;
    if (depth <= 0 && (line.includes(' from ') || line.endsWith(';') || line.endsWith('}'))) {
      exports.push(normalize(buffer));
      buffer = '';
      depth = 0;
    }
  }
  if (buffer.trim()) exports.push(normalize(buffer));
  return exports.sort();
}

function snapshot() {
  const entries = [];
  for (const [key, relativeRoot] of migratedRoots) {
    const sourceRoot = path.join(repoRoot, relativeRoot);
    collectIndexes(sourceRoot, sourceRoot, key, entries);
  }
  for (const pkg of fs.readdirSync(nextRoot, { withFileTypes: true })) {
    if (!pkg.isDirectory() || pkg.name === 'scripts') continue;
    const sourceRoot = path.join(nextRoot, pkg.name, 'src');
    if (!fs.existsSync(sourceRoot)) continue;
    collectIndexes(sourceRoot, sourceRoot, pkg.name, entries);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function collectIndexes(directory, sourceRoot, publicName, result) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectIndexes(file, sourceRoot, publicName, result);
    else if (entry.isFile() && entry.name === 'index.ts') {
      const subpath = path.relative(sourceRoot, directory);
      result.push([subpath ? `${publicName}/${subpath}` : publicName, exportsFrom(file)]);
    }
  }
}

const current = snapshot();
if (process.argv.includes('--update')) {
  fs.writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${path.relative(nextRoot, snapshotPath)}.`);
} else {
  assert.deepEqual(current, JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  console.log(`Plugin Runtime API surface check passed (${Object.keys(current).length} exports).`);
}
