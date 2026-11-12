#!/usr/bin/env node
/**
 * Harness：检测插件/业务路径是否绕过 Adapter.sendMessage 链直调 bot.$sendMessage。
 * 适配器包内 Endpoint 实现中的 $sendMessage 定义不在扫描范围内。
 *
 * 另外检查适配器 Agent 工具（plugins/adapters/<name>/agents/**）：它们必须经 IM 出站链
 * （`context.use(outboundMessageToken).send(...)` → OutboundRenderer → 出站中间件 → Endpoint）发送消息，
 * 不能直调平台 SDK / Client 的发送接口。确实无法由出站链表达的调用列在
 * `scripts/agent-send-bypass-allowlist.json`（文件 + 调用名 + 理由）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const scanRoots = [
  'packages/im/zhin/src',
  'packages/im/agent/src',
  'plugins/features',
  'packages/host',
  'plugins/adapters',
  'plugins/utils',
];

const skipDirNames = new Set(['node_modules', 'lib', 'dist', 'coverage', '.git']);

/** @param {string} dir @param {string[]} acc */
function walkTs(dir, acc) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkTs(p, acc);
    else if ((name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts') && !p.includes(`${path.sep}tests${path.sep}`)) {
      acc.push(p);
    }
  }
}

const botSendRe = /\bbot\.\$sendMessage\s*\(/g;

let violations = [];

for (const rel of scanRoots) {
  const abs = path.join(repoRoot, rel);
  const files = [];
  walkTs(abs, files);
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    if (!botSendRe.test(txt)) {
      botSendRe.lastIndex = 0;
      continue;
    }
    botSendRe.lastIndex = 0;
    const lines = txt.split(/\r?\n/);
    lines.forEach((line, i) => {
      botSendRe.lastIndex = 0;
      if (botSendRe.test(line)) {
        violations.push({ file: path.relative(repoRoot, file), line: i + 1, text: line.trim() });
      }
    });
  }
}

// Platform send calls an adapter Agent tool must not make (CLAUDE.md Guardrail #1).
const agentSendRe = /(?:\.|\b)(send|sendMessage|sendMsg|sendPayload|sendPrivateMsg|sendGroupMsg|sendForwardMsg|sendGroupForwardMsg|sendPrivateForwardMsg|sendPoll|sendSticker\w*|sendTextMessage|sendWorkNotice|sendGroupAiRecord|postMessage|forward\w*SingleMsg|threads\.create)\s*\(/g;
const allowlist = JSON.parse(fs.readFileSync(path.join(__dirname, 'agent-send-bypass-allowlist.json'), 'utf8'));
const allowed = new Set(allowlist.map((entry) => `${entry.file}\0${entry.call}`));
const usedAllow = new Set();
const agentViolations = [];
const adaptersRoot = path.join(repoRoot, 'plugins/adapters');
for (const adapter of fs.existsSync(adaptersRoot) ? fs.readdirSync(adaptersRoot) : []) {
  const files = [];
  walkTs(path.join(adaptersRoot, adapter, 'agents'), files);
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (line.includes('outboundMessageToken')) return; // the IM outbound port itself
      for (const match of line.matchAll(agentSendRe)) {
        const call = match[1];
        if (call === 'send' && !/\.send\s*\(/.test(line)) continue;
        const key = `${rel}\0${call}`;
        if (allowed.has(key)) { usedAllow.add(key); continue; }
        agentViolations.push({ file: rel, line: i + 1, text: line.trim() });
      }
    });
  }
}
const staleAllow = allowlist.filter((entry) => !usedAllow.has(`${entry.file}\0${entry.call}`));

if (agentViolations.length || staleAllow.length) {
  if (agentViolations.length) {
    console.error('Harness check: adapter Agent tools call a platform send API directly instead of the IM outbound chain:\n');
    for (const v of agentViolations) console.error(`  ${v.file}:${v.line}: ${v.text}`);
    console.error('\nSend with context.use(outboundMessageToken).send({ requester, conversation, content }) (platform-specific content as a');
    console.error('namespaced segment such as `discord:embed`), or record a justified exception in scripts/agent-send-bypass-allowlist.json.\n');
  }
  if (staleAllow.length) {
    console.error('Harness check: stale entries in scripts/agent-send-bypass-allowlist.json (no matching call):\n');
    for (const entry of staleAllow) console.error(`  ${entry.file}: ${entry.call}`);
    console.error('');
  }
  process.exit(1);
}

if (violations.length) {
  console.error('Harness check: direct bot.$sendMessage() bypasses Adapter.sendMessage / before.sendMessage chain:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.text}`);
  }
  console.error('\nUse adapter.sendMessage(SendOptions) or message.$reply(...) instead.\n');
  process.exit(1);
}

console.log(`Harness send-path check: OK (no bot.$sendMessage in scanned plugin paths; adapter Agent tools use the outbound chain, ${allowlist.length} allowlisted).`);
