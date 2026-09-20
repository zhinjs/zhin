#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'plugins/utils/60s');
const violations = [];

function source(relative) {
  return fs.readFileSync(path.join(pluginRoot, relative), 'utf8');
}

function report(relative, content, index, label) {
  violations.push({
    file: `plugins/utils/60s/${relative}`,
    line: content.slice(0, index).split(/\r?\n/u).length,
    label,
  });
}

for (const relative of ['plugin.ts', 'src/api.ts', 'src/client.ts']) {
  const content = source(relative);
  for (const [pattern, label] of [
    [/\b(?:registerSixtySApiBase|resolveApiBase)\b/u, 'process-global API base registry'],
    [/runtime-deps\.js/u, 'removed runtime dependency module'],
    [/^const\s+registrations\s*=/mu, 'module-global registration stack'],
    [/@zhin\.js\/agent\/tools/u, 'non-resource-aware Agent Tool definition'],
  ]) {
    const match = pattern.exec(content);
    if (match) report(relative, content, match.index, label);
  }
}

for (const directory of ['commands', 'skills/60s/tools']) {
  const root = path.join(pluginRoot, directory);
  for (const name of fs.readdirSync(root, {recursive: true})) {
    if (typeof name !== 'string' || !name.endsWith('.ts')) continue;
    const relative = path.join(directory, name);
    const content = source(relative);
    if (!content.includes('sixtySClientToken')) {
      report(relative, content, 0, 'capability does not resolve its owner-scoped client');
    }
    const oldAuthoring = /@zhin\.js\/agent\/tools/u.exec(content);
    if (oldAuthoring) {
      report(relative, content, oldAuthoring.index, 'non-resource-aware Agent Tool definition');
    }
  }
}

for (const name of fs.readdirSync(path.join(pluginRoot, 'src/handlers'))) {
  if (!name.endsWith('.ts')) continue;
  const relative = `src/handlers/${name}`;
  const content = source(relative);
  if (/function\s*\(client:\s*SixtySClient(?:,|\))/u.test(content)) continue;
  report(relative, content, 0, 'handler does not require an explicit client');
}

if (violations.length > 0) {
  console.error('60s runtime boundary check: FAILED\n');
  console.error('Resolve SixtySClient from the current capability owner; never restore shared registration state.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.label}`);
  }
  process.exit(1);
}

console.log('60s runtime boundary check: passed');
