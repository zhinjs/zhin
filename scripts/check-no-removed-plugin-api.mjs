#!/usr/bin/env node
/**
 * Ban calls to Plugin lookup APIs that are absent from the public surface, and the removed legacy
 * startup entry (`bootstrapNode`, `zhin.js/node`).
 *
 * Scans every example, plugin and package source (plus `basic/` for the runtime-wide rules);
 * `lib/`, `dist/`, `node_modules/`, tests and fixtures are skipped. Comments are blanked with the shared
 * string-aware stripper (`scripts/lib/strip-comments.mjs`) before the per-line rules run. Code whose job
 * is to detect a removed API is exempt line by line through `DESCRIBES_REMOVED_API` (file → reason +
 * the exact line fragments); an unused fragment fails the check.
 *
 * Not covered: specifiers assembled at run time (`import(base + '/node')`, `require(name)`).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/strip-comments.mjs';

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

/**
 * Repo-relative files whose code detects a removed API on purpose → reason and the line fragments that
 * are exempt (every other line of the file is still checked).
 * @type {Readonly<Record<string, Readonly<{ reason: string; lines: readonly string[] }>>>}
 */
export const DESCRIBES_REMOVED_API = Object.freeze({
  // Empty today: the self-change trial's detectors (`/\bbootstrapNode\b/u`, the escaped `zhin\.js\/node`
  // pattern) do not match themselves, so packages/im/agent/src/self-change/trial.ts needs no exemption.
});

/**
 * Import of the deleted `zhin.js/node` entry (static, dynamic, require, require.resolve,
 * import.meta.resolve, side-effect, re-export; quotes or backticks; subpaths). The self-change trial
 * keeps an identical copy (`SELF_CHANGE_REMOVED_NODE_ENTRY_IMPORT`, asserted by the test).
 */
export const REMOVED_NODE_ENTRY_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire(?:\.resolve)?\s*\(\s*|\bimport\.meta\.resolve\s*\(\s*|\bimport\s+)(['"`])zhin\.js\/node(?:\/[^'"`]*)?\1/u;
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

/**
 * Is this line of `relative` an exempt detector line? Marks the fragment as used.
 * @param {string} relative repo-relative POSIX path
 * @param {string} line
 * @param {Set<string>} [used]
 * @param {Readonly<Record<string, Readonly<{ reason: string; lines: readonly string[] }>>>} [exemptions]
 */
export function isExemptDetectorLine(relative, line, used, exemptions = DESCRIBES_REMOVED_API) {
  const entry = exemptions[relative];
  const fragment = entry?.lines.find((candidate) => line.includes(candidate));
  if (!fragment) return false;
  used?.add(`${relative}\0${fragment}`);
  return true;
}

/** Per-run cache: file → raw lines and comment-stripped lines (each file is read and stripped once). */
let sourceCache = new Map();

function readSource(file) {
  let entry = sourceCache.get(file);
  if (!entry) {
    const text = fs.readFileSync(file, 'utf8');
    entry = { raw: text.split(/\r?\n/u), lines: stripComments(text).split(/\r?\n/u) };
    sourceCache.set(file, entry);
  }
  return entry;
}

function collect(roots, pattern, violations, project = executableLine, used = new Set()) {
  for (const root of roots) {
    const files = [];
    walkTypeScript(path.join(repoRoot, root), files);
    for (const file of files) {
      const posix = path.relative(repoRoot, file).split(path.sep).join('/');
      const { raw, lines } = readSource(file);
      for (let index = 0; index < lines.length; index += 1) {
        if (!pattern.test(project(lines[index]))) continue;
        if (isExemptDetectorLine(posix, raw[index], used)) continue;
        const relative = path.relative(repoRoot, file);
        if (violations.some((violation) => violation.file === relative && violation.line === index + 1)) continue;
        violations.push({
          file: path.relative(repoRoot, file),
          line: index + 1,
          text: raw[index].trim(),
        });
      }
    }
  }
}

export function findRemovedApiViolations() {
sourceCache = new Map();
const violations = [];
const used = new Set();
collect(pluginRoots, /\b(?:usePlugin|getPlugin)\s*\(/u, violations, executableLine, used);
collect(allRuntimeRoots, /\b(?:getHostRootPlugin|setHostRootPlugin)\s*\(/u, violations, executableLine, used);
collect(allRuntimeRoots, /\b(?:createGenerationStore|GenerationStoreContext)\b/u, violations, executableLine, used);
collect(allRuntimeRoots, /\bPackageCompatibilityError\b|['"]\.\/compatibility\.js['"]/u, violations, executableLine, used);
collect(
  allRuntimeRoots,
  /\b(?:RuntimeEndpointSummary|resolveActivityFeedbackForTarget|resolveDefaultProviderFromConfig)\b/u,
  violations,
  executableLine,
  used,
);
collect(allRuntimeRoots, REMOVED_BOOTSTRAP_NODE, violations, executableLine, used);
collect(allRuntimeRoots, REMOVED_NODE_ENTRY_IMPORT, violations, codeLine, used);
for (const [file, entry] of Object.entries(DESCRIBES_REMOVED_API)) {
  for (const fragment of entry.lines) {
    if (used.has(`${file}\0${fragment}`)) continue;
    violations.push({ file, line: 0, text: `stale DESCRIBES_REMOVED_API fragment (no matching line): ${fragment}` });
  }
}
sourceCache = new Map();
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
