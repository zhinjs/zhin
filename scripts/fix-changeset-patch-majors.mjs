#!/usr/bin/env node
/**
 * When Changesets marks a release as patch-only but bumps major (e.g. agent 0.x→1.x
 * baseline), restore the expected patch increment from main.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function findPackageJsonFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (!statSync(p).isDirectory()) {
      if (name === 'package.json') acc.push(p);
      continue;
    }
    if (name === 'node_modules' || name === 'lib' || name === 'dist') continue;
    findPackageJsonFiles(p, acc);
  }
  return acc;
}

function getMainVersion(pkgPath) {
  try {
    const content = execSync(`git show HEAD:${pkgPath}`, { encoding: 'utf8' });
    return JSON.parse(content).version;
  } catch {
    return null;
  }
}

function incPatch(version) {
  const parts = version.split('.').map(Number);
  parts[2] = (parts[2] ?? 0) + 1;
  return parts.join('.');
}

function parseLatestChangelog(changelogPath) {
  if (!existsSync(changelogPath)) return null;
  const content = readFileSync(changelogPath, 'utf8');
  const match = content.match(/^## ([^\n]+)\n\n### (Patch|Minor|Major) Changes/m);
  if (!match) return null;
  return { version: match[1].trim(), type: match[2] };
}

const roots = ['basic', 'packages', 'plugins', 'examples'];
const pkgPaths = roots.flatMap((root) => (existsSync(root) ? findPackageJsonFiles(root) : []));

const fixes = [];

for (const pkgPath of pkgPaths) {
  const changelogPath = pkgPath.replace(/package\.json$/, 'CHANGELOG.md');
  const mainVer = getMainVersion(pkgPath);
  if (!mainVer) continue;

  const entry = parseLatestChangelog(changelogPath);
  if (!entry || entry.type !== 'Patch') continue;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const expected = incPatch(mainVer);
  if (pkg.version === expected) continue;

  fixes.push({ name: pkg.name, from: pkg.version, to: expected, changelogPath, oldHeader: entry.version });
  pkg.version = expected;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  if (existsSync(changelogPath)) {
    let cl = readFileSync(changelogPath, 'utf8');
    cl = cl.replace(`## ${entry.version}\n`, `## ${expected}\n`);
    writeFileSync(changelogPath, cl);
  }
}

for (const { name, from, to } of fixes) {
  console.log(`${name}: ${from} -> ${to}`);
}

const versionMap = Object.fromEntries(fixes.map((f) => [f.from, f.to]));
versionMap['5.0.0'] = '4.1.0';
versionMap['2.0.0'] = '1.0.1';

const changelogPaths = pkgPaths.map((p) => p.replace(/package\.json$/, 'CHANGELOG.md')).filter(existsSync);

for (const changelogPath of changelogPaths) {
  let content = readFileSync(changelogPath, 'utf8');
  let changed = false;
  for (const [from, to] of Object.entries(versionMap)) {
    const pkgRe = new RegExp(`(zhin\\.js|@[\\w./-]+)@${from.replace(/\./g, '\\.')}`, 'g');
    const next = content.replace(pkgRe, `$1@${to}`);
    if (next !== content) {
      content = next;
      changed = true;
    }
  }
  if (changed) writeFileSync(changelogPath, content);
}

console.log(`Fixed ${fixes.length} package version(s).`);
