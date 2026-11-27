#!/usr/bin/env node
/**
 * ADR 0044 §6: runtime code reads adapter capabilities, never platform names.
 *
 * Scans core / agent / ai / adapter runtime sources, the instance composition root
 * (packages/im/zhin/src/instance) and the management gateway (packages/host/gateway/src) for platform-name string
 * literals (`'icqq'`, `"discord"`, ...) and unquoted platform-name object keys (`telegram: ...`,
 * `kook?: ...`). Platform names are collected from the adapter packages (`plugins/adapters/*`, see
 * `collectAdapterPlatformNames`) plus `EXTRA_PLATFORM_NAMES`. Comments, tests and `.d.ts` files are ignored. A genuine exception must be listed in
 * `scripts/no-platform-branches-allowlist.json` with a reason.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const SCAN_ROOTS = [
  'packages/im/core/src',
  'packages/im/agent/src',
  'packages/im/ai/src',
  'packages/im/adapter/src',
  'packages/im/zhin/src/instance',
  'packages/host/gateway/src',
];

/**
 * Hand-written platform names that are not an adapter id of their own: protocol / product family names
 * a runtime branch could still test for.
 */
export const EXTRA_PLATFORM_NAMES = Object.freeze(['onebot', 'weixin', 'wechat', 'feishu', 'wxwork']);

/**
 * Adapter ids declared by the adapter packages in `plugins/adapters/*`: every package whose
 * `package.json#zhin.features` lists `@zhin.js/adapter` contributes the names of its `adapters/<name>/`
 * convention directories (the id the Adapter registers under, which is what a branch would compare
 * against), plus its package name without the `@zhin.js/adapter-` prefix.
 * @param {string} [root] repository root
 * @returns {string[]}
 */
export function collectAdapterPlatformNames(root = repoRoot) {
  const adaptersRoot = path.join(root, 'plugins/adapters');
  const names = new Set();
  for (const entry of fs.existsSync(adaptersRoot) ? fs.readdirSync(adaptersRoot) : []) {
    const manifestPath = path.join(adaptersRoot, entry, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const features = Array.isArray(manifest.zhin?.features) ? manifest.zhin.features : [];
    if (!features.some((feature) => feature?.package === '@zhin.js/adapter')) continue;
    const conventionDir = path.join(adaptersRoot, entry, 'adapters');
    if (fs.existsSync(conventionDir)) {
      for (const name of fs.readdirSync(conventionDir)) {
        if (fs.statSync(path.join(conventionDir, name)).isDirectory()) names.add(name);
      }
    }
    const fromPackage = typeof manifest.name === 'string' ? /^@zhin\.js\/adapter-(.+)$/u.exec(manifest.name)?.[1] : undefined;
    if (fromPackage) names.add(fromPackage);
  }
  return [...names].sort();
}

export const PLATFORM_NAMES = Object.freeze([...new Set([...collectAdapterPlatformNames(), ...EXTRA_PLATFORM_NAMES])]);

/**
 * Adapter ids that are also ordinary English words / field names (`line: 3`, `email: ...`). They are
 * flagged as string literals (`=== 'line'`) but not as unquoted object keys.
 */
export const LITERAL_ONLY_NAMES = Object.freeze(['email', 'github', 'line']);

const ALLOWLIST_FILE = path.join(repoRoot, 'scripts/no-platform-branches-allowlist.json');
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', '__tests__']);
const escapeName = (name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
// Longest first so `onebot11` wins over `onebot`.
const byLength = [...PLATFORM_NAMES].sort((a, b) => b.length - a.length);
const names = byLength.map(escapeName).join('|');
const keyNames = byLength.filter((name) => !LITERAL_ONLY_NAMES.includes(name) && !name.includes('-')).map(escapeName).join('|');
const LITERAL = new RegExp(`(['"\`])(${names})\\1`, 'g');
const KEY = new RegExp(`(?<![\\w.$'"\`-])(${keyNames})\\??\\s*:(?!:)`, 'g');

function walk(directory, files) {
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) {
    if (SKIPPED_DIRECTORIES.has(name)) continue;
    const entry = path.join(directory, name);
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) walk(entry, files);
    else if (/\.tsx?$/u.test(name) && !name.endsWith('.d.ts') && !/\.(test|spec)\.tsx?$/u.test(name)) files.push(entry);
  }
}

/** Blank out comments while keeping string contents and line numbers. */
export function stripComments(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

/** Replace the inside of string / template literals with spaces (keys are only looked for in code). */
function blankStrings(line) {
  return line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);
}

export function findPlatformBranches(source) {
  const hits = [];
  const lines = stripComments(source).split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(LITERAL)) hits.push({ line: index + 1, name: match[2], kind: 'literal', text: line.trim() });
    for (const match of blankStrings(line).matchAll(KEY)) hits.push({ line: index + 1, name: match[1], kind: 'key', text: line.trim() });
  });
  return hits;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return [];
  const entries = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
  const invalid = entries.filter((entry) => !entry.file || !entry.name || !entry.reason);
  if (invalid.length > 0) {
    console.error('Allowlist entries need file, name and reason:', JSON.stringify(invalid));
    process.exit(1);
  }
  return entries;
}

export function run() {
  const allowlist = loadAllowlist();
  const used = new Set();
  const violations = [];
  for (const root of SCAN_ROOTS) {
    const files = [];
    walk(path.join(repoRoot, root), files);
    for (const file of files) {
      const relative = path.relative(repoRoot, file).split(path.sep).join('/');
      for (const hit of findPlatformBranches(fs.readFileSync(file, 'utf8'))) {
        const index = allowlist.findIndex((entry) => entry.file === relative && entry.name === hit.name);
        if (index !== -1) { used.add(index); continue; }
        violations.push({ file: relative, ...hit });
      }
    }
  }
  const stale = allowlist.filter((_, index) => !used.has(index));
  if (violations.length === 0 && stale.length === 0) {
    console.log(`No platform-name branches in ${SCAN_ROOTS.join(', ')} (${allowlist.length} allowlisted).`);
    return 0;
  }
  for (const v of violations) {
    console.error(`${v.file}:${v.line} platform name '${v.name}' (${v.kind}): ${v.text}`);
  }
  for (const entry of stale) console.error(`Stale allowlist entry (no longer matches): ${entry.file} '${entry.name}'`);
  if (violations.length > 0) {
    console.error('\nRead an adapter capability (ADR 0044) instead, or add a reasoned entry to scripts/no-platform-branches-allowlist.json.');
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run());
}
