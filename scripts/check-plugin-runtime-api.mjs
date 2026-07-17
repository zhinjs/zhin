#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const snapshotPath = path.join(repoRoot, 'tests/snapshots/plugin-runtime-api.json');
const migratedRoots = [
  ['plugin-runtime', 'packages/im/plugin-runtime/src'],
  ['feature-kit', 'packages/im/feature-kit/src'],
  ['adapter', 'packages/im/adapter/src'],
  ['command', 'packages/im/command/src'],
  ['component', 'packages/im/component/src'],
  ['middleware', 'packages/im/middleware/src'],
  ['core/runtime', 'packages/im/core/src/plugin-runtime/im'],
  ['tool', 'packages/im/tool/src'],
  ['skill', 'packages/im/skill/src'],
  ['agent-feature', 'packages/im/agent-feature/src'],
  ['mcp-feature', 'packages/im/mcp-feature/src'],
  ['agent/runtime', 'packages/im/agent/src/plugin-runtime'],
  ['console-contract', 'packages/console/plugin-contract/src'],
  ['page', 'packages/console/page/src'],
  ['layout', 'packages/console/layout/src'],
  ['pagemanager/plugin-runtime', 'packages/console/pagemanager/src/plugin-runtime'],
  ['pagemanager/client-build', 'packages/console/pagemanager/src/client-build'],
  ['runtime', 'packages/im/runtime/src'],
  ['config-yaml', 'packages/im/config-yaml/src'],
  ['isolate', 'packages/im/isolate/src'],
  ['cli/runtime', 'basic/cli/src/plugin-runtime'],
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
  console.log(`Updated ${path.relative(repoRoot, snapshotPath)}.`);
} else {
  assert.deepEqual(current, JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  console.log(`Plugin Runtime API surface check passed (${Object.keys(current).length} exports).`);
}
