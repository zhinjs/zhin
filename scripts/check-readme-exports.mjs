#!/usr/bin/env node
/**
 * 检查 README 中 TypeScript 代码块的 named import 是否在对应包 index 导出中出现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** @type {Record<string, string>} */
const PKG_TO_DIR = {
  'zhin.js': 'packages/im/zhin',
  '@zhin.js/kernel': 'packages/im/kernel',
  '@zhin.js/ai': 'packages/im/ai',
  '@zhin.js/core': 'packages/im/core',
  '@zhin.js/agent': 'packages/im/agent',
};

for (const ent of fs.readdirSync(path.join(repoRoot, 'plugins/adapters'), { withFileTypes: true })) {
  if (!ent.isDirectory()) continue;
  const pkgJson = path.join(repoRoot, 'plugins/adapters', ent.name, 'package.json');
  if (!fs.existsSync(pkgJson)) continue;
  const { name } = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
  if (name) PKG_TO_DIR[name] = path.join('plugins/adapters', ent.name);
}

const LINE_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](@zhin\.js\/[^'"]+|zhin\.js)['"]/;

const EXPORT_NAME_RE = /export\s+(?:type\s+)?\{([^}]+)\}/g;
const EXPORT_FROM_RE = /export\s*\{([^}]+)\}\s*from/g;

/**
 * @param {string} block
 */
function parseNamedImports(block) {
  return block
    .split(',')
    .map((s) => s.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .map((part) => {
      const alias = part.split(/\s+as\s+/i);
      return (alias[1] ?? alias[0]).trim();
    })
    .filter((n) => n && !n.startsWith('//'));
}

/**
 * @param {string} indexPath
 */
function collectExports(indexPath) {
  if (!fs.existsSync(indexPath)) return new Set();
  const text = fs.readFileSync(indexPath, 'utf8');
  /** @type {Set<string>} */
  const names = new Set();
  for (const m of text.matchAll(EXPORT_NAME_RE)) {
    for (const n of parseNamedImports(m[1])) names.add(n);
  }
  for (const m of text.matchAll(EXPORT_FROM_RE)) {
    for (const n of parseNamedImports(m[1])) names.add(n);
  }
  if (/export\s+\*/g.test(text)) names.add('*');
  if (/export\s+default/g.test(text)) names.add('default');
  return names;
}

/**
 * @param {string} pkgDir
 */
function resolveIndex(pkgDir) {
  const candidates = [
    path.join(pkgDir, 'src/index.ts'),
    path.join(pkgDir, 'lib/index.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * @param {string} readme
 * @returns {Generator<{ pkg: string, symbols: string[] }>}
 */
function* extractTsImports(readme) {
  const fenceRe = /```(?:typescript|ts)\n([\s\S]*?)```/g;
  let m;
  while ((m = fenceRe.exec(readme)) !== null) {
    for (const line of m[1].split('\n')) {
      const im = line.match(LINE_IMPORT_RE);
      if (!im) continue;
      yield { pkg: im[2], symbols: parseNamedImports(im[1]) };
    }
  }
}

/** @type {{ readme: string, pkg: string, symbol: string }[]} */
const violations = [];

for (const [pkgName, relDir] of Object.entries(PKG_TO_DIR)) {
  const pkgDir = path.join(repoRoot, relDir);
  const readmePath = path.join(pkgDir, 'README.md');
  const indexPath = resolveIndex(pkgDir);
  if (!fs.existsSync(readmePath) || !indexPath) continue;

  const exports = collectExports(indexPath);
  if (exports.has('*')) continue;

  const readme = fs.readFileSync(readmePath, 'utf8');
  for (const { pkg, symbols } of extractTsImports(readme)) {
    if (pkg !== pkgName) continue;
    for (const sym of symbols) {
      if (!exports.has(sym)) {
        violations.push({
          readme: path.relative(repoRoot, readmePath),
          pkg: relDir,
          symbol: sym,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error('README imports not found in package exports:\n');
  for (const v of violations) {
    console.error(`  ${v.readme}: ${v.symbol} (${v.pkg})`);
  }
  console.error(`\n${violations.length} mismatch(es).`);
  process.exit(1);
}

console.log(`README export check passed (${Object.keys(PKG_TO_DIR).length} packages).`);
