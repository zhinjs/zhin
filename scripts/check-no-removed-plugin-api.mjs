#!/usr/bin/env node
/**
 * Ban calls to Plugin lookup APIs that are absent from the public surface, and the removed legacy
 * startup entry (`bootstrapNode`, `zhin.js/node`).
 *
 * Scans every example, plugin and package source (plus `basic/` for the runtime-wide rules);
 * `lib/`, `dist/`, `node_modules/`, tests and fixtures are skipped. Files whose job is to describe or
 * detect a removed API are listed in `DESCRIBES_REMOVED_API` with a reason.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pluginRoots = Object.freeze([
  'examples',
  'plugins',
  'packages',
]);
export const allRuntimeRoots = Object.freeze([
  'basic',
  ...pluginRoots,
]);
const skippedDirectories = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', '__tests__', 'fixtures']);

/** Repo-relative files that detect / describe a removed API on purpose → reason. */
export const DESCRIBES_REMOVED_API = Object.freeze({
  'packages/im/agent/src/self-change/trial.ts':
    'The self-change trial rejects drafts that use bootstrapNode / zhin.js/node; its detection regex names the API.',
});

/** Import of the deleted `zhin.js/node` entry (static, dynamic, require, side-effect, re-export). */
export const REMOVED_NODE_ENTRY_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])zhin\.js\/node(?:\/[^'"`]*)?\1/u;
/** Any executable reference to `bootstrapNode` (call, import binding, re-export). */
export const REMOVED_BOOTSTRAP_NODE = /\bbootstrapNode\b/u;

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

function commentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Raw line with comment lines blanked (string contents kept — import specifiers are strings). */
export function codeLine(line) {
  return commentLine(line) ? '' : line;
}

/** Line with comment lines blanked and string literals removed. */
export function executableLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) return '';
  return line.replace(
    /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^"\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g,
    '',
  );
}

function collect(roots, pattern, violations, project = executableLine) {
  for (const root of roots) {
    const files = [];
    walkTypeScript(path.join(repoRoot, root), files);
    for (const file of files) {
      if (Object.hasOwn(DESCRIBES_REMOVED_API, path.relative(repoRoot, file).split(path.sep).join('/'))) continue;
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        if (!pattern.test(project(lines[index]))) continue;
        const relative = path.relative(repoRoot, file);
        if (violations.some((violation) => violation.file === relative && violation.line === index + 1)) continue;
        violations.push({
          file: path.relative(repoRoot, file),
          line: index + 1,
          text: lines[index].trim(),
        });
      }
    }
  }
}

export function findRemovedApiViolations() {
const violations = [];
collect(pluginRoots, /\b(?:usePlugin|getPlugin)\s*\(/u, violations);
collect(allRuntimeRoots, /\b(?:getHostRootPlugin|setHostRootPlugin)\s*\(/u, violations);
collect(allRuntimeRoots, /\b(?:createGenerationStore|GenerationStoreContext)\b/u, violations);
collect(allRuntimeRoots, /\bPackageCompatibilityError\b|['"]\.\/compatibility\.js['"]/u, violations);
collect(
  allRuntimeRoots,
  /\b(?:RuntimeEndpointSummary|resolveActivityFeedbackForTarget|resolveDefaultProviderFromConfig)\b/u,
  violations,
);
collect(allRuntimeRoots, REMOVED_BOOTSTRAP_NODE, violations);
collect(allRuntimeRoots, REMOVED_NODE_ENTRY_IMPORT, violations, codeLine);
return violations;
}

export function run() {
  const violations = findRemovedApiViolations();
  if (violations.length > 0) {
    console.error('Removed runtime APIs are forbidden in production source:\n');
    for (const violation of violations) {
      console.error(`  ${violation.file}:${violation.line}  ${violation.text}`);
    }
    console.error('\nzhin.js/node / bootstrapNode are deleted: use definePlugin() + `zhin start`.');
    return 1;
  }
  console.log('check:no-removed-plugin-api passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
