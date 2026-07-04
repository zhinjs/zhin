#!/usr/bin/env node
/**
 * Harness: IM scene/session identity SSOT (ADR 0028).
 *
 * - agent / zhin must import resolveIMSessionId* from @zhin.js/core, not @zhin.js/ai
 * - forbid ad-hoc scene_id derivation (channel id before sender id) outside SSOT modules
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scanRoots = [
  'packages/im/agent/src',
  'packages/im/zhin/src',
];

const ssotAllowlist = new Set([
  'packages/im/core/src/im-scene.ts',
  'packages/im/core/src/im-session-id.ts',
  'packages/im/kernel/src/im-identity.ts',
]);

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests']);

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if (
      (name.endsWith('.ts') || name.endsWith('.tsx'))
      && !name.endsWith('.test.ts')
      && !name.endsWith('.spec.ts')
    ) {
      acc.push(p);
    }
  }
}

/** @type {{ file: string, line: number, reason: string, text: string }[]} */
const violations = [];

const aiSessionImportRe = /from\s+['"]@zhin\.js\/ai['"]/;
const sessionSymbolImportRe = /\bresolveIMSessionId(?:FromMessage|FromScene)?\b/;
const adhocSceneIdRe = /\$channel\?\.\s*id\s*(?:\|\||\?\?)\s*\$sender/;

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);

  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      if (aiSessionImportRe.test(line) && sessionSymbolImportRe.test(line)) {
        violations.push({
          file: relFile,
          line: i + 1,
          reason: 'Import resolveIMSessionId* from @zhin.js/core (SSOT), not @zhin.js/ai',
          text: trimmed,
        });
      }

      if (!ssotAllowlist.has(relFile) && adhocSceneIdRe.test(line)) {
        violations.push({
          file: relFile,
          line: i + 1,
          reason: 'Use resolveSceneFieldsFromMessage / sceneRefFromMessage instead of ad-hoc channel→sender scene_id',
          text: trimmed,
        });
      }
    }
  }
}

if (violations.length) {
  console.error('Harness IM session SSOT check: FAILED\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.reason}`);
    console.error(`    ${v.text}\n`);
  }
  process.exit(1);
}

console.log('Harness IM session SSOT check: OK.');
