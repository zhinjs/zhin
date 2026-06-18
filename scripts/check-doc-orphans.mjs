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
  linked.add(route);
}

/** 无需侧栏的页面（首页、变更日志、维护者参考、snippets 等） */
const ALLOWLIST = new Set([
  '/',
  '/changelog/',
  '/playground/',
  '/advanced/miniclawd-reference/',
  '/advanced/typing-indicator-adapters/',
  '/snippets/',
  '/snippets/install-tiers/',
]);

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
  if (/readme\.md$/i.test(rel)) {
    const dir = path.dirname(rel).replace(/\\/g, '/');
    if (!dir || dir === '.') return '/';
    return `/${dir}/`;
  }
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
    if (ent.name.startsWith('.') || ent.name === 'public') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectMd(abs));
    else if (ent.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

/** @type {{ file: string, route: string }[]} */
const orphans = [];

for (const abs of collectMd(docsRoot)) {
  const rel = path.relative(docsRoot, abs);
  const route = toRoute(rel);
  if (ALLOWLIST.has(route)) continue;
  if (hasSidebarFalse(abs)) continue;
  if (linked.has(route)) continue;
  orphans.push({ file: rel, route });
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
