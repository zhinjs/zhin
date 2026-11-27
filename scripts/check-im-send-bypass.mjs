#!/usr/bin/env node
/**
 * Harness：检测插件 / 业务路径是否绕过 IM 出站链（`Message.$reply` / Runtime 出站端口 → OutboundRenderer →
 * 出站中间件 → Endpoint），直调 Endpoint、transport 或平台 client 的发送接口。
 *
 * 1. 插件代码（`plugins/**` 中非适配器实现部分、`examples/**`）以及框架宿主源码（`packages/im/zhin/src`、
 *    `packages/im/agent/src`、`packages/host/*\/src`）按 `scripts/lib/send-bypass-rules.mjs` 的规则扫描；
 *    自改代码试运行（`packages/im/agent/src/self-change/trial.ts`）使用同一组模式。适配器包自己的 Endpoint
 *    实现（`plugins/adapters/<name>/src/**`、`adapters/**`）与测试辅助 `plugins/adapters/test-utils` 不扫描。
 * 2. 适配器 Agent 工具（plugins/adapters/<name>/agents/**）必须经 IM 出站链
 *    （`context.use(outboundMessageToken).send(...)`）发送消息，不能直调平台 SDK / Client 的发送接口。
 *
 * 确实无法由出站链表达的调用列在 `scripts/agent-send-bypass-allowlist.json`：Agent 工具条目为
 * 文件 + 调用名（`call`）+ 理由；插件 / 宿主条目为文件 + 规则 id（`rule`）+ 理由。两类条目都可以再加文本片段
 * （`text`），只放行包含该片段的那一行；保留的宿主条目必须写片段，不能按整文件放行。
 *
 * 规则对整份文件匹配（换行的链式调用也算），注释先用 `scripts/lib/strip-comments.mjs` 换成空格，
 * 字符串里的 `//`、`/*` 不会被当成注释。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSendBypasses, stripComments } from './lib/send-bypass-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/** Roots scanned with the shared send-bypass rules (repo-relative). */
export const SCAN_ROOTS = Object.freeze([
  'packages/im/zhin/src',
  'packages/im/agent/src',
  'packages/host',
  'plugins',
  'examples',
]);

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git', 'tests', '__tests__']);

/**
 * Adapter packages implement the platform send themselves: their Endpoint sources (`src/`, `adapters/`)
 * are legal, `agents/` has its own rule below, and `test-utils` is a test helper.
 * @param {string} rel repo-relative POSIX path
 */
export function isAdapterImplementationPath(rel) {
  return /^plugins\/adapters\/(?:test-utils\/|[^/]+\/(?:src|adapters|agents)\/)/u.test(rel);
}

/** @param {string} rel */
function isTestFile(rel) {
  return /\.(?:test|spec)\.tsx?$|\.test-d\.tsx?$|\.d\.ts$/u.test(rel);
}

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(p);
  }
}

/** @param {string} file */
const toRel = (file) => path.relative(repoRoot, file).split(path.sep).join('/');

// Platform send calls an adapter Agent tool must not make (CLAUDE.md Guardrail #1).
const agentSendRe = /(?:\.|\b)(send|sendMessage|sendMsg|sendPayload|sendPrivateMsg|sendGroupMsg|sendForwardMsg|sendGroupForwardMsg|sendPrivateForwardMsg|sendPoll|sendSticker\w*|sendTextMessage|sendWorkNotice|sendGroupAiRecord|postMessage|forward\w*SingleMsg|threads\.create)\s*\(/g;

/**
 * Allowlist entry → does it cover this hit? Plugin / host entries name a rule (`rule`), adapter Agent
 * tool entries a call (`call`); either may narrow itself to lines containing a text fragment (`text`).
 * @param {{ file: string; rule?: string; call?: string; text?: string }} entry
 * @param {{ file: string; rule?: string; call?: string; text: string }} hit
 */
export function allowlistCovers(entry, hit) {
  if (entry.file !== hit.file) return false;
  if (entry.rule ? entry.rule !== hit.rule : entry.call !== hit.call) return false;
  return !entry.text || hit.text.includes(entry.text);
}

export function run() {
  const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-send-bypass-allowlist.json'), 'utf8'));
  const usedAllow = new Set();
  /** @param {{ file: string; rule?: string; call?: string; text: string }} hit */
  const allow = (hit) => {
    const index = allowlist.findIndex((entry) => allowlistCovers(entry, hit));
    if (index < 0) return false;
    usedAllow.add(index);
    return true;
  };

  /** @type {Array<{ file: string; line: number; id: string; text: string }>} */
  const violations = [];
  for (const root of SCAN_ROOTS) {
    const files = [];
    walkTs(path.join(repoRoot, root), files);
    for (const file of files) {
      const rel = toRel(file);
      if (isTestFile(rel) || isAdapterImplementationPath(rel)) continue;
      if (rel.startsWith('packages/host/') && !/^packages\/host\/[^/]+\/src\//u.test(rel)) continue;
      for (const hit of findSendBypasses(fs.readFileSync(file, 'utf8'))) {
        if (allow({ file: rel, rule: hit.id, text: hit.text })) continue;
        violations.push({ file: rel, ...hit });
      }
    }
  }

  const agentViolations = [];
  const adaptersRoot = path.join(repoRoot, 'plugins/adapters');
  for (const adapter of fs.existsSync(adaptersRoot) ? fs.readdirSync(adaptersRoot) : []) {
    const files = [];
    walkTs(path.join(adaptersRoot, adapter, 'agents'), files);
    for (const file of files) {
      const rel = toRel(file);
      if (isTestFile(rel)) continue;
      stripComments(fs.readFileSync(file, 'utf8')).split(/\r?\n/).forEach((line, i) => {
        if (line.includes('outboundMessageToken')) return; // the IM outbound port itself
        for (const match of line.matchAll(agentSendRe)) {
          const call = match[1];
          if (call === 'send' && !/\.send\s*\(/.test(line)) continue;
          if (allow({ file: rel, call, text: line.trim() })) continue;
          agentViolations.push({ file: rel, line: i + 1, text: line.trim() });
        }
      });
    }
  }
  const staleAllow = allowlist.filter((_entry, index) => !usedAllow.has(index));

  let failed = false;
  if (agentViolations.length) {
    failed = true;
    console.error('Harness check: adapter Agent tools call a platform send API directly instead of the IM outbound chain:\n');
    for (const v of agentViolations) console.error(`  ${v.file}:${v.line}: ${v.text}`);
    console.error('\nSend with context.use(outboundMessageToken).send({ requester, conversation, content }) (platform-specific content as a');
    console.error('namespaced segment such as `discord:embed`), or record a justified exception in scripts/agent-send-bypass-allowlist.json.\n');
  }
  if (violations.length) {
    failed = true;
    console.error('Harness check: plugin / host code bypasses the IM outbound chain (Message.$reply / outbound port → OutboundRenderer → Endpoint):\n');
    for (const v of violations) console.error(`  ${v.file}:${v.line} [${v.id}]: ${v.text}`);
    console.error('\nReply with message.$reply() / $sendTo(), or send with context.use(outboundMessageToken).send(...); record a justified');
    console.error('exception as { file, rule, reason } in scripts/agent-send-bypass-allowlist.json.\n');
  }
  if (staleAllow.length) {
    failed = true;
    console.error('Harness check: stale entries in scripts/agent-send-bypass-allowlist.json (no matching call):\n');
    for (const entry of staleAllow) console.error(`  ${entry.file}: ${entry.rule ?? entry.call}${entry.text ? ` (text: ${entry.text})` : ''}`);
    console.error('');
  }
  if (failed) return 1;

  console.log(`Harness send-path check: OK (no outbound-chain bypass in ${SCAN_ROOTS.join(', ')}; adapter Agent tools use the outbound chain; ${allowlist.length} allowlisted).`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
