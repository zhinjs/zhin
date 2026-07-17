#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const nextRoot = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(nextRoot, 'api-surface.json');

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
  for (const pkg of fs.readdirSync(nextRoot, { withFileTypes: true })) {
    if (!pkg.isDirectory() || pkg.name === 'scripts') continue;
    const sourceRoot = path.join(nextRoot, pkg.name, 'src');
    if (!fs.existsSync(sourceRoot)) continue;
    collectIndexes(sourceRoot, pkg.name, entries);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function collectIndexes(directory, packageName, result) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectIndexes(file, packageName, result);
    else if (entry.isFile() && entry.name === 'index.ts') {
      const subpath = path.relative(path.join(nextRoot, packageName, 'src'), directory);
      result.push([subpath ? `${packageName}/${subpath}` : packageName, exportsFrom(file)]);
    }
  }
}

const current = snapshot();
if (process.argv.includes('--update')) {
  fs.writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Updated ${path.relative(nextRoot, snapshotPath)}.`);
} else {
  assert.deepEqual(current, JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  console.log(`Next API surface check passed (${Object.keys(current).length} packages).`);
}
