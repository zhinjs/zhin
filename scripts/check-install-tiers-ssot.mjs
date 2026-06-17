#!/usr/bin/env node
/**
 * 校验仓库根 README 的 Install tiers 表与 docs/snippets/install-tiers.md#tiers-table 一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snippetPath = path.join(repoRoot, 'docs/snippets/install-tiers.md');
const readmePath = path.join(repoRoot, 'README.md');

/** @param {string} text @param {string} region */
function extractRegion(text, region) {
  const re = new RegExp(
    `<!-- #region ${region} -->\\n([\\s\\S]*?)\\n<!-- #endregion ${region} -->`,
  );
  const m = text.match(re);
  if (!m) throw new Error(`region not found: ${region}`);
  return m[1].trim();
}

/** @param {string} block */
function dataRows(block) {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('| **'));
}

const snippetRows = dataRows(extractRegion(fs.readFileSync(snippetPath, 'utf8'), 'tiers-table'));

const readme = fs.readFileSync(readmePath, 'utf8');
const section = readme.match(
  /### Install tiers（zhin\.js 4\.x）\s*\n+([\s\S]*?)(?=\n### |\n## |$)/,
);
if (!section) {
  console.error('check-install-tiers-ssot: README Install tiers section not found');
  process.exit(1);
}

const readmeRows = dataRows(section[1]);
if (readmeRows.length === 0) {
  console.error('check-install-tiers-ssot: no data rows in README section');
  process.exit(1);
}

const missing = snippetRows.filter((r) => !readmeRows.includes(r));
const extra = readmeRows.filter((r) => !snippetRows.includes(r));

if (missing.length || extra.length) {
  console.error('check-install-tiers-ssot: README diverges from docs/snippets/install-tiers.md#tiers-table');
  if (missing.length) console.error('  missing in README:', missing);
  if (extra.length) console.error('  extra in README:', extra);
  process.exit(1);
}

console.log('Install tiers SSOT check passed (README ↔ snippets/install-tiers.md).');
