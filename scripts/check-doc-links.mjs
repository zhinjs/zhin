#!/usr/bin/env node
/**
 * 检查 Markdown / Cursor 规则中的相对链接是否指向仓库内存在的文件。
 * 除下方 scanRoots 外，还扫描 basic/、packages/、plugins/、examples/ 下所有受版本控制的 README.md。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** @type {string[]} */
const scanRoots = [
  'AGENTS.md',
  'README.md',
  'README.zh-CN.md',
  'CLAUDE.md',
  '.github/copilot-instructions.md',
  'docs',
  'examples/minimal-bot',
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

const README_ROOTS = ['basic', 'packages', 'plugins', 'examples'];

/**
 * Every tracked README.md under the workspace package roots (falls back to a
 * filesystem walk when git is unavailable, e.g. in an exported tarball).
 * @returns {string[]}
 */
function collectPackageReadmes() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', ...README_ROOTS], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\0')
      .filter((rel) => path.basename(rel) === 'README.md')
      .map((rel) => path.join(repoRoot, rel))
      .filter((abs) => fs.existsSync(abs));
  } catch {
    /** @type {string[]} */
    const found = [];
    /** @param {string} dir */
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', 'lib', 'dist'].includes(ent.name)) continue;
        const child = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(child);
        else if (ent.name === 'README.md') found.push(child);
      }
    };
    for (const root of README_ROOTS) {
      const abs = path.join(repoRoot, root);
      if (fs.existsSync(abs)) walk(abs);
    }
    return found;
  }
}

/** @type {string[]} */
const files = [];
for (const root of scanRoots) {
  files.push(...collectFiles(root));
}
files.push(...collectPackageReadmes());

/**
 * @param {string} fromFile
 * @param {string} href
 */
function resolveTarget(fromFile, href) {
  const decoded = decodeURIComponent(href.split('#')[0]);
  if (decoded.startsWith('/')) {
    // Site-absolute inside docs/ (VitePress); repo-root-absolute everywhere else (GitHub).
    const inDocs = !path.relative(path.join(repoRoot, 'docs'), fromFile).startsWith('..');
    return inDocs
      ? path.join(repoRoot, 'docs', decoded.slice(1))
      : path.join(repoRoot, decoded.slice(1));
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
  const relativeToDocs = path.relative(path.join(repoRoot, 'docs'), target);
  if (!relativeToDocs.startsWith('..')
    && fs.existsSync(path.join(repoRoot, 'docs/public', relativeToDocs))) return true;
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
