#!/usr/bin/env node
/**
 * Harness：getPlugin() 禁止出现在运行时回调内（中间件、action、execute 等）。
 * 启发式：.action / .execute / addMiddleware / addCron / .on( 之后的函数体中不得调用 getPlugin()。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const scanRoots = [
  'plugins/adapters',
  'plugins/features',
  'plugins/utils',
  'plugins/games',
  'examples/minimal-bot/src/plugins',
  'examples/full-bot/src/plugins',
  'examples/demo-bot/src/plugins',
  'examples/test-bot/src/plugins',
  'packages/im/agent/src',
  'packages/im/zhin/src',
];

/** Paths where getPlugin() at registration/bootstrap is intentional */
const getPluginAllowlist = [
  '/init/',
  'plugin-context.ts',
  'host-plugin-registry.ts',
  'packages/im/core/src/built/',
];

/** @param {string} relFile */
function isGetPluginAllowlisted(relFile) {
  const normalized = relFile.replace(/\\/g, '/');
  return getPluginAllowlist.some((p) => normalized.includes(p));
}

const CALLBACK_MARKERS = [
  /\.action\s*\(/,
  /\.execute\s*\(/,
  /addMiddleware\s*\(/,
  /addCron\s*\(/,
  /\.on(?:ce)?\s*\(/,
];

/** @param {string} line */
function lineHasGetPluginCall(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) return false;
  const noStrings = line.replace(
    /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^'\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g,
    '',
  );
  return /\bgetPlugin\s*\(/.test(noStrings);
}

/** @param {string} line */
function lineHasCallbackMarker(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) return false;
  const noStrings = line.replace(
    /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^'\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g,
    '',
  );
  return CALLBACK_MARKERS.some((re) => re.test(noStrings));
}

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

/** @type {{ file: string, line: number, text: string }[]} */
const violations = [];

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    if (!/\bgetPlugin\s*\(/.test(txt)) continue;

    let depth = 0;
    /** @type {number | null} */
    let callbackBodyDepth = null;
    let pendingCallback = false;
    const lines = txt.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (lineHasGetPluginCall(line) && callbackBodyDepth !== null && depth >= callbackBodyDepth) {
        const relFile = path.relative(repoRoot, file);
        if (isGetPluginAllowlisted(relFile)) continue;
        violations.push({
          file: relFile,
          line: i + 1,
          text: line.trim(),
        });
      }

      if (lineHasCallbackMarker(line)) {
        pendingCallback = true;
      }

      for (const ch of line) {
        if (ch === '{') {
          depth++;
          if (pendingCallback) {
            callbackBodyDepth = depth;
            pendingCallback = false;
          }
        } else if (ch === '}') {
          depth = Math.max(0, depth - 1);
          if (callbackBodyDepth !== null && depth < callbackBodyDepth) {
            callbackBodyDepth = null;
          }
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error('getPlugin() must not be called inside runtime callbacks (middleware, action, execute, cron, on):\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error('\nCapture plugin/root at registration time and use closures instead.');
  process.exit(1);
}

console.log('check:get-plugin-runtime passed.');
