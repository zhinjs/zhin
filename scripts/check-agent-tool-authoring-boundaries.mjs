#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoots = ['basic', 'packages', 'plugins', 'examples'];
const ignoredDirectories = new Set(['node_modules', 'lib', 'dist', '.git']);
const violations = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else files.push(target);
  }
  return files;
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

function report(file, label, line = 1) {
  violations.push({ file: relative(file), line, label });
}

function lineOf(content, index) {
  return content.slice(0, index).split(/\r?\n/u).length;
}

function findPackageRoot(file) {
  let current = path.dirname(file);
  while (current.startsWith(repoRoot)) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

const files = workspaceRoots.flatMap((root) => walk(path.join(repoRoot, root)));
const packageRoots = new Set();
for (const file of files) {
  const content = /\.(?:[cm]?[jt]sx?|json)$/u.test(file)
    ? fs.readFileSync(file, 'utf8')
    : '';
  const oldImport = /(?:from\s+|import\(\s*)['"]@zhin\.js\/agent\/tools['"]/u.exec(content);
  if (oldImport) report(file, 'removed @zhin.js/agent/tools import', lineOf(content, oldImport.index));

  if (!/^\$.*\.ts$/u.test(path.basename(file))) continue;
  const packageRoot = findPackageRoot(file);
  if (!packageRoot) continue;
  const packageRelative = path.relative(packageRoot, file).split(path.sep).join('/');
  if (packageRelative.startsWith('tools/')) {
    report(file, 'package-root tools/$*.ts entry; use agent/tools/$*.ts');
  }
  if (packageRelative.startsWith('agent/tools/')) packageRoots.add(packageRoot);
}

for (const packageRoot of packageRoots) {
  const manifestPath = path.join(packageRoot, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.dependencies?.['@zhin.js/tool'] !== 'workspace:*') {
    report(manifestPath, 'agent/tools package must depend on @zhin.js/tool');
  }
  if (!manifest.zhin?.features?.some((feature) => feature.package === '@zhin.js/tool')) {
    report(manifestPath, 'agent/tools package must mount the @zhin.js/tool Feature');
  }
}

const agentManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'packages/im/agent/package.json'), 'utf8'));
if (agentManifest.exports?.['./tools']) {
  report(path.join(repoRoot, 'packages/im/agent/package.json'), 'removed ./tools export restored');
}

if (violations.length > 0) {
  console.error('Agent Tool authoring boundary check: FAILED\n');
  console.error('Use one authoring surface: @zhin.js/tool + agent/tools/$*.ts.\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.label}`);
  }
  process.exit(1);
}

console.log(`Agent Tool authoring boundary check: passed (${packageRoots.size} packages)`);
