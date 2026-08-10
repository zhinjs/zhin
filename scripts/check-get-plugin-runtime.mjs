#!/usr/bin/env node
/**
 * Harness：
 * 1. getPlugin() 已删除——禁止在插件/示例源码中出现任何 getPlugin() 调用。
 *    框架内部（packages/im/*）的残留调用属于 dead code，由后续切片清除。
 * 2. getHostRootPlugin() 禁止出现在 ideal agent turn 路径模块中（core/skill/turn/…）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── Check 1: ban getPlugin() in plugin/example source ──

const getPluginScanRoots = [
  'plugins/adapters',
  'plugins/features',
  'plugins/utils',
  'plugins/games',
  'plugins/services',
  'examples/minimal-bot',
  'examples/full-bot',
  'examples/test-bot',
];

/** @param {string} line */
function lineIsCommentOrDoc(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**');
}

/** @param {string} line @param {RegExp} pattern */
function lineHasCall(line, pattern) {
  if (lineIsCommentOrDoc(line)) return false;
  const noStrings = line.replace(
    /('[^'\\]*(?:\\.[^'\\]*)*'|"[^"\\]*(?:\\.[^'\\]*)*"|`[^`\\]*(?:\\.[^`\\]*)*`)/g,
    '',
  );
  return pattern.test(noStrings);
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
const getPluginViolations = [];

for (const rel of getPluginScanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    if (!/\bgetPlugin\s*\(/.test(txt)) continue;
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lineHasCall(lines[i], /\bgetPlugin\s*\(/)) {
        getPluginViolations.push({
          file: path.relative(repoRoot, file),
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }
}

if (getPluginViolations.length > 0) {
  console.error('getPlugin() has been removed — no calls allowed in plugin/example source:\n');
  for (const v of getPluginViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

// ── Check 2: ban getHostRootPlugin() calls everywhere (definition in host-plugin-registry.ts exempt) ──

const getHostRootPluginBanRoots = [
  'packages/im/agent/src',
  'packages/im/core/src',
  'packages/im/zhin/src',
  'plugins/adapters',
  'plugins/features',
  'plugins/utils',
  'plugins/games',
  'plugins/services',
  'examples/minimal-bot',
  'examples/full-bot',
  'examples/test-bot',
];

const getHostRootPluginDefinitionFile = 'packages/im/core/src/host-plugin-registry.ts';

/** @type {{ file: string, line: number, text: string }[]} */
const hostRootViolations = [];

for (const rel of getHostRootPluginBanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    if (relFile === getHostRootPluginDefinitionFile) continue;
    const txt = fs.readFileSync(file, 'utf8');
    if (!/\bgetHostRootPlugin\s*\(/.test(txt)) continue;
    const lines = txt.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lineHasCall(lines[i], /\bgetHostRootPlugin\s*\(/)) {
        hostRootViolations.push({
          file: relFile,
          line: i + 1,
          text: lines[i].trim(),
        });
      }
    }
  }
}

if (hostRootViolations.length > 0) {
  console.error(
    'getHostRootPlugin() has been removed — no calls allowed (use Scope+Token instead):\n',
  );
  for (const v of hostRootViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exit(1);
}

console.log('check:get-plugin-runtime passed.');
