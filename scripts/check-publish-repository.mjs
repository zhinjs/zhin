#!/usr/bin/env node
/**
 * Harness: publishable packages must declare repository.url matching the monorepo
 * (npm provenance / Sigstore requires it to equal https://github.com/zhinjs/zhin).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = 'https://github.com/zhinjs/zhin';

const scanRoots = [
  'basic',
  'packages',
  'plugins',
];

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'examples']);

/** @param {string} dir @param {string[]} acc */
function walkPackageJson(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkPackageJson(p, acc);
    else if (name === 'package.json') acc.push(p);
  }
}

/** @param {unknown} url */
function normalizeRepoUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  return url
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

/** @type {string[]} */
const failures = [];

for (const root of scanRoots) {
  const files = [];
  walkPackageJson(path.join(repoRoot, root), files);
  for (const file of files) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pkg.private === true) continue;
    if (!pkg.name || typeof pkg.name !== 'string') continue;
    // Skip non-publishable tooling inside packages without name scope / without publishConfig
    // but still require all workspace npm packages that can be published
    const rel = path.relative(repoRoot, file);
    const url = normalizeRepoUrl(pkg.repository?.url);
    if (!url) {
      failures.push(`${rel}: missing repository.url (need ${EXPECTED} for npm provenance)`);
      continue;
    }
    if (url !== EXPECTED) {
      failures.push(`${rel}: repository.url="${pkg.repository.url}" must normalize to ${EXPECTED}`);
    }
  }
}

if (failures.length) {
  console.error('Publish repository.url check failed:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    '\nWith npm --provenance, repository.url must match the GitHub Actions repo.\n' +
      'Example:\n' +
      '  "repository": { "type": "git", "url": "git+https://github.com/zhinjs/zhin.git", "directory": "plugins/..." }\n',
  );
  process.exit(1);
}

console.log('check:publish-repository passed.');
