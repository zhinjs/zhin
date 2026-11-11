#!/usr/bin/env node
// 检查 docs 下 Markdown 是否出现在 VitePress 侧栏/nav，或 frontmatter sidebar:false / allowlist。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const docsRoot = path.join(repoRoot, 'docs');
const configPath = path.join(docsRoot, '.vitepress/config.ts');

const configText = fs.readFileSync(configPath, 'utf8');

/** @type {Set<string>} */
const linked = new Set();

for (const m of configText.matchAll(/link:\s*['"](\/[^'"]+)['"]/g)) {
  let route = m[1];
  if (!route.endsWith('/')) route += '/';
  linked.add(route.toLowerCase());
}

/** 无需侧栏的页面（仅首页；其余页面用侧栏链接或 frontmatter `sidebar: false`） */
const ALLOWLIST = new Set(['/']);

// 不发布为站点页面的文件，与 .vitepress/config.ts 的 srcExclude 保持一致：
// snippets 目录、根 README.md、根 CHANGELOG.md、plans 目录。
/** @param {string} rel docs 下相对路径（posix） */
function isExcludedFromSite(rel) {
  if (rel === 'README.md' || rel === 'CHANGELOG.md') return true;
  if (rel.startsWith('plans/')) return true;
  return rel.split('/').includes('snippets');
}

const srcExcludeLine = configText.split('\n').find((line) => line.includes('srcExclude:')) ?? '';
for (const pattern of ["'**/snippets/**'", "'README.md'", "'CHANGELOG.md'", "'plans/**'"]) {
  if (!srcExcludeLine.includes(pattern)) {
    console.error(`check-doc-orphans: srcExclude in docs/.vitepress/config.ts no longer lists ${pattern}; update isExcludedFromSite().`);
    process.exit(1);
  }
}

/**
 * @param {string} filePath
 */
function hasSidebarFalse(filePath) {
  const head = fs.readFileSync(filePath, 'utf8').slice(0, 400);
  return /^---[\s\S]*?sidebar:\s*false[\s\S]*?---/m.test(head);
}

/**
 * @param {string} rel docs 下相对路径，如 getting-started/index.md
 */
function toRoute(rel) {
  // Only index.md is a directory index in VitePress; README.md is an ordinary page.
  let r = '/' + rel.replace(/\.md$/i, '').replace(/\\/g, '/');
  if (r === '/index' || r === '/index/') return '/';
  if (r.endsWith('/index')) r = r.slice(0, -'/index'.length) + '/';
  else if (!r.endsWith('/')) r += '/';
  return r.toLowerCase();
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectMd(dir) {
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') || ent.name === 'public' || ent.name === 'node_modules') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectMd(abs));
    else if (ent.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

/** @type {{ file: string, route: string }[]} */
const orphans = [];

for (const abs of collectMd(docsRoot)) {
  const rel = path.relative(docsRoot, abs).replace(/\\/g, '/');
  if (isExcludedFromSite(rel)) continue;
  const route = toRoute(rel);
  if (ALLOWLIST.has(route)) continue;
  if (hasSidebarFalse(abs)) continue;
  if (linked.has(route)) continue;
  orphans.push({ file: rel, route });
}

/** @type {string[]} */
const dangling = [];
const pageRoutes = new Set(collectMd(docsRoot)
  .map((abs) => path.relative(docsRoot, abs).replace(/\\/g, '/'))
  .filter((rel) => !isExcludedFromSite(rel))
  .map(toRoute));
for (const route of linked) {
  if (!pageRoutes.has(route)) dangling.push(route);
}
if (dangling.length > 0) {
  console.error('VitePress nav/sidebar links that point to no page:\n');
  for (const route of dangling.sort()) console.error(`  ${route}`);
  console.error(`\n${dangling.length} dangling link(s).`);
  process.exit(1);
}

if (orphans.length > 0) {
  console.error('Documentation pages not in VitePress nav/sidebar (add link or sidebar: false):\n');
  for (const o of orphans) {
    console.error(`  ${o.file}  →  ${o.route}`);
  }
  console.error(`\n${orphans.length} orphan page(s).`);
  process.exit(1);
}

console.log(`Doc orphan check passed (${linked.size} sidebar routes).`);
