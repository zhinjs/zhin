#!/usr/bin/env node
/** Ensure published plugins ship every package-root capability directory. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoots = [
  'plugins/adapters',
  'plugins/utils',
  'plugins/services',
  'plugins/features',
  'plugins/games',
];
const capabilityEntries = [
  'AGENTS.md',
  'PERMITS.md',
  'agents',
  'evals',
  'hooks',
  'prompt-sections',
  'skills',
  'tools',
];
const violations = [];

for (const root of pluginRoots) {
  const absolute = path.join(repoRoot, root);
  if (!fs.existsSync(absolute)) continue;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'common') continue;
    checkPlugin(path.join(absolute, entry.name));
  }
}

if (violations.length > 0) {
  console.error('Plugin capability publish check: FAILED\n');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('Plugin capability publish check: OK');

function checkPlugin(pluginRoot) {
  const present = capabilityEntries.filter((entry) => fs.existsSync(path.join(pluginRoot, entry)));
  if (present.length === 0) return;
  const relative = path.relative(repoRoot, pluginRoot);
  const manifestPath = path.join(pluginRoot, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    violations.push(`${relative}: capability directories require package.json`);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.private !== true) {
    const published = new Set(manifest.files ?? []);
    for (const entry of present) {
      if (!published.has(entry)) violations.push(`${relative}: files must include ${entry}`);
    }
  }
  if (!manifest.scripts?.build) violations.push(`${relative}: missing build script`);
  if (!manifest.scripts?.prepublishOnly || !/build/u.test(manifest.scripts.prepublishOnly)) {
    violations.push(`${relative}: prepublishOnly must invoke build`);
  }
  if (manifest.dependencies?.['@zhin.js/agent']) {
    violations.push(`${relative}: @zhin.js/agent must be an optional peer and dev dependency`);
  }
}
