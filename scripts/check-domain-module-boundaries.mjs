#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boundaries = [
  {
    name: 'Workroom Journal',
    directory: 'packages/im/agent/src/workroom/journal',
  },
  {
    name: 'Workroom Projection Outbox',
    directory: 'packages/im/agent/src/workroom/projection-outbox',
  },
  {
    name: 'Host Extended Console RPC',
    directory: 'packages/host/http/src/console-rpc-extended',
  },
];

const roots = ['basic', 'packages', 'plugins', 'examples', 'tests'];
const sourceFiles = roots.flatMap(root => collectTypeScriptFiles(path.join(repoRoot, root)));
const violations = [];

for (const absoluteFile of sourceFiles) {
  const relativeFile = relative(absoluteFile);
  const source = fs.readFileSync(absoluteFile, 'utf8');
  const imports = [...source.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/gu)];
  for (const match of imports) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const resolvedTarget = path.resolve(
      path.dirname(absoluteFile),
      specifier.replace(/\.js$/u, '.ts'),
    );
    for (const boundary of boundaries) {
      const absoluteBoundary = path.join(repoRoot, boundary.directory);
      const canonicalEntry = path.join(absoluteBoundary, 'index.ts');
      const insideBoundary = absoluteFile.startsWith(`${absoluteBoundary}${path.sep}`);
      if (insideBoundary) continue;
      const deepImport = resolvedTarget.startsWith(`${absoluteBoundary}${path.sep}`)
        && resolvedTarget !== canonicalEntry;
      const removedEntry = resolvedTarget === `${absoluteBoundary}.ts`;
      if (!deepImport && !removedEntry) continue;
      violations.push({
        file: relativeFile,
        line: source.slice(0, match.index).split(/\r?\n/u).length,
        boundary: boundary.name,
        specifier,
      });
    }
  }
}

for (const boundary of boundaries) {
  const legacyFile = `${boundary.directory}.ts`;
  if (fs.existsSync(path.join(repoRoot, legacyFile))) {
    violations.push({ file: legacyFile, line: 1, boundary: boundary.name, specifier: 'legacy flat entry' });
  }
  if (!fs.existsSync(path.join(repoRoot, boundary.directory, 'index.ts'))) {
    violations.push({
      file: `${boundary.directory}/index.ts`,
      line: 1,
      boundary: boundary.name,
      specifier: 'missing canonical entry',
    });
  }
}

if (violations.length > 0) {
  console.error('Domain module boundary check: FAILED\n');
  console.error('Import a deep domain module through its canonical index.ts entry.\n');
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.boundary}: ${violation.specifier}`,
    );
  }
  process.exit(1);
}

console.log('Domain module boundary check: passed');

function collectTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(target));
    else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) files.push(target);
  }
  return files;
}

function relative(absolutePath) {
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}
