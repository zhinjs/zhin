#!/usr/bin/env node
/**
 * Harness: 禁止在 plugins/* 包根新增顶层 `skills/`（须使用 agent/skills/*.md）。
 * 工作区 cwd/skills、.agents/skills 不在检查范围。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const pluginRoots = [
  'plugins/adapters',
  'plugins/utils',
  'plugins/services',
  'plugins/features',
  'plugins/games',
];

/** Allowlist: rare exceptions (empty = none). Paths relative to repo root. */
const ALLOWLIST = new Set([
  // e.g. 'plugins/utils/foo/skills' — none currently
]);

const violations = [];

for (const root of pluginRoots) {
  const absRoot = path.join(repoRoot, root);
  if (!fs.existsSync(absRoot)) continue;
  for (const pkg of fs.readdirSync(absRoot, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const skillsDir = path.join(absRoot, pkg.name, 'skills');
    if (!fs.existsSync(skillsDir)) continue;
    const rel = path.relative(repoRoot, skillsDir);
    if (ALLOWLIST.has(rel)) continue;
    violations.push(rel);
  }
}

if (violations.length > 0) {
  console.error('check-no-package-skills: FAILED — use agent/skills/*.md instead of package-root skills/\n');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('check-no-package-skills: OK (no package-root skills/)');
