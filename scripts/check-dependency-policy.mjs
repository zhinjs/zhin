#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs|json)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const sourceRoots = [
  'packages/toolkit/scaffold-wizard/src',
  'packages/toolkit/create-zhin/src',
  'basic/cli/src',
];

for (const sourceRoot of sourceRoots) {
  for (const file of walk(path.join(root, sourceRoot))) {
    if (file.endsWith('stack-versions.generated.json')) continue;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes('stack-versions.generated')) {
      failures.push(`${path.relative(root, file)} imports stack-versions.generated.json`);
    }
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts ?? {};
if ('sync:scaffold-deps' in scripts) {
  failures.push('package.json still exposes sync:scaffold-deps');
}
if ('check:scaffold-deps-ssot' in scripts) {
  failures.push('package.json still exposes check:scaffold-deps-ssot');
}
if (typeof scripts.bump === 'string' && scripts.bump.includes('sync:scaffold-deps')) {
  failures.push('package.json bump still runs sync:scaffold-deps');
}

const policyFiles = [
  'packages/toolkit/scaffold-wizard/src/project-deps.ts',
  'packages/toolkit/scaffold-wizard/src/zhin-stack-deps.ts',
  'packages/toolkit/scaffold-wizard/src/optional-peers.ts',
  'packages/toolkit/create-zhin/src/workspace.ts',
];

for (const rel of policyFiles) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  if (!text.includes("'latest'")) {
    failures.push(`${rel} does not contain the latest dependency policy`);
  }
}

if (failures.length > 0) {
  console.error('Dependency policy check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Dependency policy check passed.');
