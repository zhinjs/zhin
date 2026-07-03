#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const adrDir = path.join(root, 'docs/adr');
const readme = fs.readFileSync(path.join(adrDir, 'README.md'), 'utf8');
const vitepressConfig = fs.readFileSync(path.join(root, 'docs/.vitepress/config.ts'), 'utf8');

const adrFiles = fs.readdirSync(adrDir)
  .filter((file) => /^\d{4}-.+\.md$/.test(file))
  .sort();

const failures = [];
for (const file of adrFiles) {
  const link = file.replace(/\.md$/, '');
  if (!readme.includes(`./${file}`)) {
    failures.push(`docs/adr/README.md is missing ${file}`);
  }
  if (!vitepressConfig.includes(`/adr/${link}`)) {
    failures.push(`docs/.vitepress/config.ts sidebar is missing ${file}`);
  }
}

if (failures.length > 0) {
  console.error('ADR manifest check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`ADR manifest check passed (${adrFiles.length} ADRs).`);
