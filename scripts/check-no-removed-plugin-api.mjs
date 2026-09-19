#!/usr/bin/env node
/** Ban calls to Plugin lookup APIs that are absent from the public surface. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoots = [
  'plugins/adapters',
  'plugins/features',
  'plugins/utils',
  'plugins/games',
  'plugins/services',
  'examples/minimal-bot',
  'examples/full-bot',
  'examples/test-bot',
];
const allRuntimeRoots = [
  'basic',
  'packages',
  ...pluginRoots,
];
const skippedDirectories = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests']);

function walkTypeScript(directory, files) {
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    if (skippedDirectories.has(name)) continue;
    const entry = path.join(directory, name);
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) walkTypeScript(entry, files);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx'))
      && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts')) files.push(entry);
  }
}

function executableLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) return '';
  return line.replace(
    /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g,
    '',
  );
}

function collect(roots, pattern, violations) {
  for (const root of roots) {
    const files = [];
    walkTypeScript(path.join(repoRoot, root), files);
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        if (!pattern.test(executableLine(lines[index]))) continue;
        violations.push({
          file: path.relative(repoRoot, file),
          line: index + 1,
          text: lines[index].trim(),
        });
      }
    }
  }
}

const violations = [];
collect(pluginRoots, /\b(?:usePlugin|getPlugin)\s*\(/u, violations);
collect(allRuntimeRoots, /\b(?:getHostRootPlugin|setHostRootPlugin)\s*\(/u, violations);
collect(allRuntimeRoots, /\b(?:createGenerationStore|GenerationStoreContext)\b/u, violations);

if (violations.length > 0) {
  console.error('Removed runtime APIs are forbidden in production source:\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
  }
  process.exit(1);
}

console.log('check:no-removed-plugin-api passed.');
