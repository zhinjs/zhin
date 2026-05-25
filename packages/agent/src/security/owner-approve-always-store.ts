/**
 * Owner 对 bash / icqq CLI 的放行策略（持久化 data/owner-approve-always.json）。
 *
 * - **bashAlways**：跳过 shell 需 Owner 审批（含 ZHIN_NEEDS_OWNER 硬编排）的全局开关（仅 bash 工具链）。
 * - **bashRules**：正则列表；在 exec 策略中若 **整条待检子命令** 匹配任一规则，则视为已放行（不固化解参数，例如 `^icqq\\s+friend\\s+like\\b`）。
 *
 * icqq 子命令：非敏感操作默认直接放行；仅命中 {@link ICQQ_SENSITIVE_SUBCOMMAND_REGEXES} 时需审批，除非 always 或规则匹配。
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Adapter, Message, Plugin, ToolContext } from '@zhin.js/core';
import { getDataDir } from '../discovery/utils.js';

export const OWNER_APPROVE_ALWAYS_TOOL = 'bash' as const;

const STORE_FILE = 'owner-approve-always.json';
const STORE_VERSION = 2 as const;

/** 需 Owner 审批的 icqq 子命令（正则匹配整段子命令文本，大小写不敏感） */
export const ICQQ_SENSITIVE_SUBCOMMAND_REGEXES: readonly RegExp[] = [
  /\bicqq\s+friend\s+delete\b/i,
  /\bicqq\s+friend\s+block\b/i,
  /\bicqq\s+friend\s+move\b/i,
  /\bicqq\s+group\s+kick\b/i,
  /\bicqq\s+group\s+mute\b/i,
  /\bicqq\s+group\s+set\b/i,
  /\bicqq\s+group\s+admin\b/i,
  /\bicqq\s+group\s+announce\b/i,
  /\bicqq\s+group\s+transfer\b/i,
  /\bicqq\s+group\s+quit\b/i,
  /\bicqq\s+group\s+dissolve\b/i,
  /\bicqq\s+group\s+invite\b/i,
  /\bicqq\s+request\b/i,
  /\bicqq\s+wallet\b/i,
  /\bicqq\s+pay\b/i,
  /\bicqq\s+recall\b/i,
  /\bicqq\s+file\s+upload\b/i,
  /\bicqq\s+file\s+delete\b/i,
  /\bicqq\s+gfs\b.*\b(rm|delete|del)\b/i,
];

export interface BashRuleEntry {
  id: string;
  pattern: string;
  createdAt: number;
}

export interface BashApprovalBotEntry {
  bashAlways?: boolean;
  bashRules: BashRuleEntry[];
}

interface StoreV2 {
  version: typeof STORE_VERSION;
  bots: Record<string, BashApprovalBotEntry>;
}

interface StoreV1 {
  version: 1;
  entries: string[];
}

function storePath(): string {
  return path.join(getDataDir(), STORE_FILE);
}

function emptyV2(): StoreV2 {
  return { version: STORE_VERSION, bots: {} };
}

function normalizeBotKey(adapter: string, botId: string, ownerId: string): string {
  return `${adapter}|${botId}|${ownerId}`;
}

function migrateV1ToV2(data: StoreV1): StoreV2 {
  const out = emptyV2();
  for (const e of data.entries || []) {
    if (typeof e !== 'string') continue;
    const parts = e.split('|');
    if (parts.length !== 4) continue;
    const [adapter, botId, ownerId, scope] = parts;
    if (scope === 'orchestration:bash') {
      const k = normalizeBotKey(adapter, botId, ownerId);
      if (!out.bots[k]) out.bots[k] = { bashRules: [] };
      out.bots[k].bashAlways = true;
    }
  }
  return out;
}

function readStore(): StoreV2 {
  const p = storePath();
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const data = JSON.parse(raw) as StoreV2 | StoreV1;
    if (!data || typeof data !== 'object') return emptyV2();

    if ((data as StoreV2).version === STORE_VERSION && (data as StoreV2).bots && typeof (data as StoreV2).bots === 'object') {
      const v2 = data as StoreV2;
      for (const k of Object.keys(v2.bots)) {
        const ent = v2.bots[k];
        if (!ent.bashRules) ent.bashRules = [];
      }
      return v2;
    }

    if ((data as StoreV1).version === 1 && Array.isArray((data as StoreV1).entries)) {
      const v2 = migrateV1ToV2(data as StoreV1);
      writeStore(v2);
      return v2;
    }

    if (Array.isArray((data as unknown as { entries?: unknown }).entries)) {
      const v2 = migrateV1ToV2({ version: 1, entries: (data as StoreV1).entries });
      writeStore(v2);
      return v2;
    }

    return emptyV2();
  } catch {
    return emptyV2();
  }
}

function writeStore(data: StoreV2): void {
  const p = storePath();
  const tmp = `${p}.${process.pid}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmp, body, 'utf-8');
  fs.renameSync(tmp, p);
}

function getBotOwner(plugin: Plugin, ctx: ToolContext): string | undefined {
  const root = plugin.root ?? plugin;
  const adapter = root.inject(ctx.platform!) as Adapter | undefined;
  const bot = adapter?.bots?.get(ctx.botId!);
  const owner = (bot?.$config as Record<string, unknown> | undefined)?.owner;
  return owner != null ? String(owner) : undefined;
}

function getEntry(plugin: Plugin, ctx: ToolContext): BashApprovalBotEntry | undefined {
  if (!ctx.platform || !ctx.botId) return undefined;
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null) return undefined;
  const key = normalizeBotKey(ctx.platform, ctx.botId, ownerId);
  const data = readStore();
  return data.bots[key];
}

function ensureEntry(plugin: Plugin, ctx: ToolContext): BashApprovalBotEntry {
  if (!ctx.platform || !ctx.botId) return { bashRules: [] };
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null) return { bashRules: [] };
  const key = normalizeBotKey(ctx.platform, ctx.botId, ownerId);
  const data = readStore();
  if (!data.bots[key]) {
    data.bots[key] = { bashRules: [] };
    writeStore(data);
  }
  return data.bots[key]!;
}

export function getOwnerToolContextOrUndefined(plugin: Plugin, message: Message<any>): ToolContext | undefined {
  if (message.$channel?.type !== 'private') return undefined;
  const ctx: ToolContext = {
    platform: message.$adapter,
    botId: message.$bot,
    sceneId: message.$channel?.id ?? message.$sender.id,
    senderId: message.$sender.id,
    message,
    scope: 'private',
  };
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null || String(message.$sender.id) !== String(ownerId)) return undefined;
  return ctx;
}

/** 编排层：是否已「永久放行」bash 的 Owner 硬确认（ZHIN_NEEDS_OWNER 路径） */
export function hasOwnerApproveAlways(plugin: Plugin, ctx: ToolContext, toolName: string): boolean {
  if (toolName !== OWNER_APPROVE_ALWAYS_TOOL) return false;
  if (!ctx.platform || !ctx.botId) return false;
  const ent = getEntry(plugin, ctx);
  return !!ent?.bashAlways;
}

export function setBashAlways(plugin: Plugin, ctx: ToolContext, value: boolean): void {
  if (!ctx.platform || !ctx.botId) return;
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null) return;
  const key = normalizeBotKey(ctx.platform, ctx.botId, ownerId);
  const data = readStore();
  const prev = data.bots[key] ?? { bashRules: [] };
  const ent: BashApprovalBotEntry = { bashRules: prev.bashRules ?? [] };
  if (prev.bashAlways !== undefined) ent.bashAlways = prev.bashAlways;
  if (value) ent.bashAlways = true;
  else delete ent.bashAlways;
  data.bots[key] = ent;
  writeStore(data);
}

export function addOwnerApproveAlways(plugin: Plugin, ctx: ToolContext, toolName: string): { ok: true } | { ok: false; error: string } {
  if (!ctx.platform || !ctx.botId) {
    return { ok: false, error: '缺少 platform / botId' };
  }
  if (toolName.trim().toLowerCase() !== OWNER_APPROVE_ALWAYS_TOOL) {
    return { ok: false, error: '永久放行仅支持 bash（shell 安全确认）。' };
  }
  if (getBotOwner(plugin, ctx) == null) {
    return { ok: false, error: '当前 Bot 未配置 owner' };
  }
  setBashAlways(plugin, ctx, true);
  return { ok: true };
}

export function removeOwnerApproveAlways(plugin: Plugin, ctx: ToolContext, toolName: string): { ok: true } | { ok: false; error: string } {
  if (!ctx.platform || !ctx.botId) {
    return { ok: false, error: '缺少 platform / botId' };
  }
  if (toolName.trim().toLowerCase() !== OWNER_APPROVE_ALWAYS_TOOL) {
    return { ok: false, error: '仅可撤销 bash 的永久放行。' };
  }
  if (getBotOwner(plugin, ctx) == null) {
    return { ok: false, error: '当前 Bot 未配置 owner' };
  }
  const ent = getEntry(plugin, ctx);
  if (!ent?.bashAlways) {
    return { ok: false, error: '当前未对 bash 设置永久放行。' };
  }
  setBashAlways(plugin, ctx, false);
  return { ok: true };
}

export function addBashApproveRule(
  plugin: Plugin,
  ctx: ToolContext,
  pattern: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return { ok: false, error: '正则不能为空。' };
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(trimmed);
  } catch (e) {
    return { ok: false, error: `无效正则: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!ctx.platform || !ctx.botId || getBotOwner(plugin, ctx) == null) {
    return { ok: false, error: '缺少 platform/botId 或未配置 owner。' };
  }
  const ownerId = getBotOwner(plugin, ctx)!;
  const key = normalizeBotKey(ctx.platform, ctx.botId, ownerId);
  const data = readStore();
  const ent: BashApprovalBotEntry = { ...(data.bots[key] ?? { bashRules: [] }), bashRules: [...(data.bots[key]?.bashRules ?? [])] };
  if (data.bots[key]?.bashAlways) ent.bashAlways = true;
  const id = crypto.randomUUID();
  ent.bashRules.push({ id, pattern: trimmed, createdAt: Date.now() });
  data.bots[key] = ent;
  writeStore(data);
  return { ok: true, id };
}

export function removeBashApproveRule(
  plugin: Plugin,
  ctx: ToolContext,
  ruleId: string,
): { ok: true } | { ok: false; error: string } {
  const id = ruleId.trim();
  if (!id) return { ok: false, error: '请提供规则 id。' };
  if (!ctx.platform || !ctx.botId || getBotOwner(plugin, ctx) == null) {
    return { ok: false, error: '缺少 platform/botId 或未配置 owner。' };
  }
  const ownerId = getBotOwner(plugin, ctx)!;
  const key = normalizeBotKey(ctx.platform, ctx.botId, ownerId);
  const data = readStore();
  const ent = data.bots[key];
  if (!ent?.bashRules?.length) return { ok: false, error: '当前无自定义规则。' };
  const next = ent.bashRules.filter((r) => r.id !== id && !r.id.startsWith(id));
  if (next.length === ent.bashRules.length) {
    return { ok: false, error: `未找到 id 前缀或全名为「${id}」的规则。` };
  }
  ent.bashRules = next;
  data.bots[key] = ent;
  writeStore(data);
  return { ok: true };
}

/** exec 策略：bashAlways 或任一 bashRules 匹配 commandLine */
export function matchesBashOwnerExecBypass(plugin: Plugin, ctx: ToolContext, commandLine: string): boolean {
  if (!ctx.platform || !ctx.botId) return false;
  const ent = getEntry(plugin, ctx);
  if (!ent) return false;
  if (ent.bashAlways) return true;
  const line = commandLine.trim();
  if (!line) return false;
  for (const r of ent.bashRules || []) {
    try {
      const re = new RegExp(r.pattern);
      if (re.test(line)) return true;
    } catch {
      /* skip broken stored pattern */
    }
  }
  return false;
}

export function formatBashApproveList(plugin: Plugin, ctx: ToolContext): string {
  const ent = getEntry(plugin, ctx);
  const always = ent?.bashAlways ? '是' : '否';
  const rules = ent?.bashRules ?? [];
  if (!ent || (!ent.bashAlways && rules.length === 0)) {
    return 'bash 永久放行: 否\n自定义正则放行: 无';
  }
  const lines = [`bash 永久放行: ${always}`, `自定义正则放行 (${rules.length}):`];
  for (const r of rules) {
    const short = r.id.slice(0, 8);
    lines.push(`  • [${short}] ${r.pattern}`);
  }
  return lines.join('\n');
}

/** 兼容旧单测：返回 bash 与 rule 摘要行 */
export function listOwnerApproveAlways(plugin: Plugin, ctx: ToolContext): string[] {
  const ent = getEntry(plugin, ctx);
  const out: string[] = [];
  if (ent?.bashAlways) out.push(OWNER_APPROVE_ALWAYS_TOOL);
  for (const r of ent?.bashRules ?? []) {
    out.push(`rule:${r.id.slice(0, 8)}:${r.pattern}`);
  }
  return out;
}

export function isIcqqSensitiveSubcommand(fullSubCommand: string): boolean {
  const line = fullSubCommand.trim();
  if (!/^\s*icqq(\s|$)/i.test(line)) return false;
  return ICQQ_SENSITIVE_SUBCOMMAND_REGEXES.some((re) => re.test(line));
}

type Pending = { toolName: string; expiresAt: number };
const pendingOrchestration = new Map<string, Pending>();

function pendingKey(adapter: string, botId: string, ownerId: string): string {
  return `${adapter}|${botId}|${ownerId}`;
}

export function setPendingOrchestrationTool(plugin: Plugin, ctx: ToolContext, toolName: string): void {
  if (toolName !== OWNER_APPROVE_ALWAYS_TOOL) return;
  if (!ctx.platform || !ctx.botId) return;
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null) return;
  pendingOrchestration.set(pendingKey(ctx.platform, ctx.botId, ownerId), {
    toolName: OWNER_APPROVE_ALWAYS_TOOL,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
}

export function clearPendingOrchestrationTool(plugin: Plugin, ctx: ToolContext): void {
  if (!ctx.platform || !ctx.botId) return;
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null) return;
  pendingOrchestration.delete(pendingKey(ctx.platform, ctx.botId, ownerId));
}

export function getPendingOrchestrationTool(plugin: Plugin, ctx: ToolContext): string | undefined {
  if (!ctx.platform || !ctx.botId) return undefined;
  const ownerId = getBotOwner(plugin, ctx);
  if (ownerId == null) return undefined;
  const key = pendingKey(ctx.platform, ctx.botId, ownerId);
  const p = pendingOrchestration.get(key);
  if (!p || p.toolName !== OWNER_APPROVE_ALWAYS_TOOL) {
    if (p) pendingOrchestration.delete(key);
    return undefined;
  }
  if (Date.now() > p.expiresAt) {
    pendingOrchestration.delete(key);
    return undefined;
  }
  return OWNER_APPROVE_ALWAYS_TOOL;
}
