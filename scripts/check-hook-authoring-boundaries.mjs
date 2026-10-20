#!/usr/bin/env node
/** Enforce named Hook directories at every supported capability scope. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoots = ['basic', 'packages', 'plugins', 'examples'];
const ignored = new Set(['node_modules', 'lib', 'dist', '.git', 'data']);
const canonical = /^(?:hooks\/[a-z0-9][a-z0-9-]*|agents\/[a-z0-9][a-z0-9-]*\/hooks\/[a-z0-9][a-z0-9-]*|skills\/[a-z0-9][a-z0-9-]*\/hooks\/[a-z0-9][a-z0-9-]*|agents\/[a-z0-9][a-z0-9-]*\/skills\/[a-z0-9][a-z0-9-]*\/hooks\/[a-z0-9][a-z0-9-]*)\/index\.ts$/u;
const violations = [];
let hookCount = 0;

for (const workspaceRoot of workspaceRoots) {
  for (const manifestPath of packageManifests(path.join(repoRoot, workspaceRoot))) {
    const packageRoot = path.dirname(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    let packageHasPublicHooks = false;
    for (const file of walk(packageRoot)) {
      const local = path.relative(packageRoot, file).split(path.sep).join('/');
      if (local.startsWith('agent/hooks/')) {
        violations.push(`${relative(file)}: legacy agent/hooks entry; use hooks/<name>/index.ts`);
      }
      if (!local.split('/').includes('hooks')) continue;
      if (path.basename(file).startsWith('$')) {
        violations.push(`${relative(file)}: Hook entry must use a named directory with index.ts`);
        continue;
      }
      if (canonical.test(local)) {
        hookCount += 1;
        packageHasPublicHooks ||= local.startsWith('hooks/');
      } else if (/\.(?:[cm]?[jt]s)$/u.test(local) && path.basename(file).startsWith('index.')) {
        violations.push(`${relative(file)}: unsupported Hook directory shape`);
      }
    }
    if (packageHasPublicHooks && manifest.private !== true && !manifest.files?.includes('hooks')) {
      violations.push(`${relative(manifestPath)}: published package with public Hooks must include hooks`);
    }
  }
}

if (violations.length > 0) {
  console.error('Hook authoring boundary check: FAILED\n');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}
console.log(`Hook authoring boundary check: passed (${hookCount} Hooks)`);

function walk(directory) {
  const files = [];
  for (const entry of safeEntries(directory)) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else files.push(target);
  }
  return files;
}

function* packageManifests(directory) {
  for (const entry of safeEntries(directory)) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    const manifest = path.join(target, 'package.json');
    if (fs.existsSync(manifest)) yield manifest;
    else yield* packageManifests(target);
  }
}

function safeEntries(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !ignored.has(entry.name));
}

function relative(target) {
  return path.relative(repoRoot, target).split(path.sep).join('/');
}
