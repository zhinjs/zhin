#!/usr/bin/env node
/**
 * 检查 Markdown / Cursor 规则中的相对链接是否指向仓库内存在的文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** @type {string[]} */
const scanRoots = [
  'AGENTS.md',
  'README.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  'docs/architecture',
  'docs/architecture-overview.md',
  'docs/contributing.md',
  'docs/contributing/harness-engineering.md',
  'docs/getting-started/index.md',
  'examples/minimal-bot',
  'examples/minimal-qbot',
  'examples/test-bot/ACCEPTANCE.md',
  'plugins/adapters/README.md',
  'examples/test-bot/README.md',
  '.cursor/rules',
];

const LINK_RE = /\]\(([^)#\s][^)#]*)(?:#[^)]*)?\)/g;

/**
 * @param {string} filePath
 * @returns {Generator<{ href: string, line: number }>}
 */
function* extractLinks(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(line)) !== null) {
      const href = m[1].trim();
      if (
        href.startsWith('http://') ||
        href.startsWith('https://') ||
        href.startsWith('mailto:') ||
        href.startsWith('data:') ||
        href.startsWith('/') ||
        href === 'url'
      ) {
        continue;
      }
      yield { href, line: i + 1 };
    }
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [abs];
  /** @type {string[]} */
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const child = path.join(abs, ent.name);
    if (ent.isDirectory()) out.push(...collectFiles(path.relative(repoRoot, child)));
    else if (/\.(md|mdc)$/i.test(ent.name)) out.push(child);
  }
  return out;
}

/** @type {string[]} */
const files = [];
for (const root of scanRoots) {
  files.push(...collectFiles(root));
}

/**
 * @param {string} fromFile
 * @param {string} href
 */
function resolveTarget(fromFile, href) {
  const decoded = decodeURIComponent(href.split('#')[0]);
  if (decoded.startsWith('/')) {
    return path.join(repoRoot, decoded.slice(1));
  }
  const base = path.dirname(fromFile);
  return path.normalize(path.join(base, decoded));
}

/**
 * @param {string} target
 */
function existsAsDoc(target) {
  if (fs.existsSync(target)) return true;
  if (fs.existsSync(target + '.md')) return true;
  if (fs.existsSync(path.join(target, 'README.md'))) return true;
  return false;
}

/** @type {{ file: string, line: number, href: string }[]} */
const broken = [];

for (const file of [...new Set(files)]) {
  for (const { href, line } of extractLinks(file)) {
    const target = resolveTarget(file, href);
    if (!target.startsWith(repoRoot)) continue;
    if (!existsAsDoc(target)) {
      broken.push({
        file: path.relative(repoRoot, file),
        line,
        href,
      });
    }
  }
}

if (broken.length > 0) {
  console.error('Broken documentation links:\n');
  for (const b of broken) {
    console.error(`  ${b.file}:${b.line}  →  ${b.href}`);
  }
  console.error(`\n${broken.length} broken link(s).`);
  process.exit(1);
}

console.log(`Doc link check passed (${files.length} files scanned).`);
