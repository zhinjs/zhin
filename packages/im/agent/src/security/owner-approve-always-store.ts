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
import type { Adapter, Message, Plugin } from '@zhin.js/core';
import { hasSenderRole, resolveSubjectRoles, senderRolesFromMessage } from '@zhin.js/core';
import { getDataDir } from '../discovery/utils.js';

export const OWNER_APPROVE_ALWAYS_TOOL = 'bash' as const;

export type ToolRequesterRole = 'master' | 'trusted' | 'other' | 'unknown';

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
  endpoints: Record<string, BashApprovalBotEntry>;
}

interface StoreV1 {
  version: 1;
  entries: string[];
}

function storePath(): string {
  return path.join(getDataDir(), STORE_FILE);
}

function emptyV2(): StoreV2 {
  return { version: STORE_VERSION, endpoints: {} };
}

function normalizeBotKey(adapter: string, endpointId: string, ownerId: string): string {
  return `${adapter}|${endpointId}|${ownerId}`;
}

function migrateV1ToV2(data: StoreV1): StoreV2 {
  const out = emptyV2();
  for (const e of data.entries || []) {
    if (typeof e !== 'string') continue;
    const parts = e.split('|');
    if (parts.length !== 4) continue;
    const [adapter, endpointId, ownerId, scope] = parts;
    if (scope === 'orchestration:bash') {
      const k = normalizeBotKey(adapter, endpointId, ownerId);
      if (!out.endpoints[k]) out.endpoints[k] = { bashRules: [] };
      out.endpoints[k].bashAlways = true;
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

    if ((data as StoreV2).version === STORE_VERSION && (data as StoreV2).endpoints && typeof (data as StoreV2).endpoints === 'object') {
      const v2 = data as StoreV2;
      for (const k of Object.keys(v2.endpoints)) {
        const ent = v2.endpoints[k];
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

export function getEndpointMaster(plugin: Plugin, commMessage: Message): string | undefined {
  const root = plugin.root ?? plugin;
  const adapter = root.inject(commMessage.$adapter) as Adapter | undefined;
  const endpoint = adapter?.endpoints?.get(commMessage.$endpoint);
  const master = (endpoint?.$config as Record<string, unknown> | undefined)?.master;
  return master != null ? String(master) : undefined;
}

function normalizeIdList(input: unknown): string[] {
  if (Array.isArray(input)) return input.map((v) => String(v)).filter(Boolean);
  if (typeof input === 'string') {
    return input
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function getEndpointTrustedIds(plugin: Plugin, commMessage: Message): string[] {
  const root = plugin.root ?? plugin;
  const adapter = root.inject(commMessage.$adapter) as Adapter | undefined;
  const endpoint = adapter?.endpoints?.get(commMessage.$endpoint);
  const endpointConfig = (endpoint?.$config as Record<string, unknown> | undefined) ?? {};
  return normalizeIdList(endpointConfig.trusted);
}

export function resolveToolRequesterRole(plugin: Plugin, commMessage: Message): ToolRequesterRole {
  const roles = senderRolesFromMessage(commMessage);
  if (commMessage.$sender.isMaster !== undefined || commMessage.$sender.isTrusted !== undefined) {
    if (hasSenderRole(roles, 'master')) return 'master';
    if (hasSenderRole(roles, 'trusted')) return 'trusted';
    return 'other';
  }
  try {
    const resolved = resolveSubjectRoles(plugin.root ?? plugin, commMessage);
    if (hasSenderRole(resolved.roles, 'master')) return 'master';
    if (hasSenderRole(resolved.roles, 'trusted')) return 'trusted';
    return 'other';
  } catch {
    if (!commMessage.$adapter || !commMessage.$endpoint || !commMessage.$sender?.id) return 'unknown';
    const senderId = String(commMessage.$sender.id);
    const masterId = getEndpointMaster(plugin, commMessage);
    if (masterId && senderId === String(masterId)) return 'master';
    const trusted = getEndpointTrustedIds(plugin, commMessage);
    if (trusted.includes(senderId)) return 'trusted';
    return 'other';
  }
}

function getEntry(plugin: Plugin, commMessage: Message): BashApprovalBotEntry | undefined {
  if (!commMessage.$adapter || !commMessage.$endpoint) return undefined;
  const ownerId = getEndpointMaster(plugin, commMessage);
  if (ownerId == null) return undefined;
  const key = normalizeBotKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId);
  const data = readStore();
  return data.endpoints[key];
}

function ensureEntry(plugin: Plugin, commMessage: Message): BashApprovalBotEntry {
  if (!commMessage.$adapter || !commMessage.$endpoint) return { bashRules: [] };
  const ownerId = getEndpointMaster(plugin, commMessage);
  if (ownerId == null) return { bashRules: [] };
  const key = normalizeBotKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId);
  const data = readStore();
  if (!data.endpoints[key]) {
    data.endpoints[key] = { bashRules: [] };
    writeStore(data);
  }
  return data.endpoints[key]!;
}

export function getOwnerCommMessageOrUndefined(plugin: Plugin, message: Message): Message | undefined {
  if (message.$channel?.type !== 'private') return undefined;
  const ownerId = getEndpointMaster(plugin, message);
  if (ownerId == null || String(message.$sender.id) !== String(ownerId)) return undefined;
  return message;
}

/** 编排层：是否已「永久放行」bash 的 Owner 硬确认（ZHIN_NEEDS_OWNER 路径） */
export function hasOwnerApproveAlways(plugin: Plugin, commMessage: Message, toolName: string): boolean {
  if (toolName !== OWNER_APPROVE_ALWAYS_TOOL) return false;
  if (!commMessage.$adapter || !commMessage.$endpoint) return false;
  const ent = getEntry(plugin, commMessage);
  return !!ent?.bashAlways;
}

export function setBashAlways(plugin: Plugin, commMessage: Message, value: boolean): void {
  if (!commMessage.$adapter || !commMessage.$endpoint) return;
  const ownerId = getEndpointMaster(plugin, commMessage);
  if (ownerId == null) return;
  const key = normalizeBotKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId);
  const data = readStore();
  const prev = data.endpoints[key] ?? { bashRules: [] };
  const ent: BashApprovalBotEntry = { bashRules: prev.bashRules ?? [] };
  if (prev.bashAlways !== undefined) ent.bashAlways = prev.bashAlways;
  if (value) ent.bashAlways = true;
  else delete ent.bashAlways;
  data.endpoints[key] = ent;
  writeStore(data);
}

export function addOwnerApproveAlways(plugin: Plugin, commMessage: Message, toolName: string): { ok: true } | { ok: false; error: string } {
  if (!commMessage.$adapter || !commMessage.$endpoint) {
    return { ok: false, error: '缺少 platform / endpointId' };
  }
  if (toolName.trim().toLowerCase() !== OWNER_APPROVE_ALWAYS_TOOL) {
    return { ok: false, error: '永久放行仅支持 bash（shell 安全确认）。' };
  }
  if (getEndpointMaster(plugin, commMessage) == null) {
    return { ok: false, error: '当前 Endpoint 未配置 owner' };
  }
  setBashAlways(plugin, commMessage, true);
  return { ok: true };
}

export function removeOwnerApproveAlways(plugin: Plugin, commMessage: Message, toolName: string): { ok: true } | { ok: false; error: string } {
  if (!commMessage.$adapter || !commMessage.$endpoint) {
    return { ok: false, error: '缺少 platform / endpointId' };
  }
  if (toolName.trim().toLowerCase() !== OWNER_APPROVE_ALWAYS_TOOL) {
    return { ok: false, error: '仅可撤销 bash 的永久放行。' };
  }
  if (getEndpointMaster(plugin, commMessage) == null) {
    return { ok: false, error: '当前 Endpoint 未配置 owner' };
  }
  const ent = getEntry(plugin, commMessage);
  if (!ent?.bashAlways) {
    return { ok: false, error: '当前未对 bash 设置永久放行。' };
  }
  setBashAlways(plugin, commMessage, false);
  return { ok: true };
}

export function addBashApproveRule(
  plugin: Plugin,
  commMessage: Message,
  pattern: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return { ok: false, error: '正则不能为空。' };
  }
  try {
     
    new RegExp(trimmed);
  } catch (e) {
    return { ok: false, error: `无效正则: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!commMessage.$adapter || !commMessage.$endpoint || getEndpointMaster(plugin, commMessage) == null) {
    return { ok: false, error: '缺少 platform/endpointId 或未配置 owner。' };
  }
  const ownerId = getEndpointMaster(plugin, commMessage)!;
  const key = normalizeBotKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId);
  const data = readStore();
  const ent: BashApprovalBotEntry = { ...(data.endpoints[key] ?? { bashRules: [] }), bashRules: [...(data.endpoints[key]?.bashRules ?? [])] };
  if (data.endpoints[key]?.bashAlways) ent.bashAlways = true;
  const id = crypto.randomUUID();
  ent.bashRules.push({ id, pattern: trimmed, createdAt: Date.now() });
  data.endpoints[key] = ent;
  writeStore(data);
  return { ok: true, id };
}

export function removeBashApproveRule(
  plugin: Plugin,
  commMessage: Message,
  ruleId: string,
): { ok: true } | { ok: false; error: string } {
  const id = ruleId.trim();
  if (!id) return { ok: false, error: '请提供规则 id。' };
  if (!commMessage.$adapter || !commMessage.$endpoint || getEndpointMaster(plugin, commMessage) == null) {
    return { ok: false, error: '缺少 platform/endpointId 或未配置 owner。' };
  }
  const ownerId = getEndpointMaster(plugin, commMessage)!;
  const key = normalizeBotKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId);
  const data = readStore();
  const ent = data.endpoints[key];
  if (!ent?.bashRules?.length) return { ok: false, error: '当前无自定义规则。' };
  const next = ent.bashRules.filter((r) => r.id !== id && !r.id.startsWith(id));
  if (next.length === ent.bashRules.length) {
    return { ok: false, error: `未找到 id 前缀或全名为「${id}」的规则。` };
  }
  ent.bashRules = next;
  data.endpoints[key] = ent;
  writeStore(data);
  return { ok: true };
}

/** exec 策略：bashAlways 或任一 bashRules 匹配 commandLine */
export function matchesBashOwnerExecBypass(plugin: Plugin, commMessage: Message, commandLine: string): boolean {
  if (!commMessage.$adapter || !commMessage.$endpoint) return false;
  const ent = getEntry(plugin, commMessage);
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

export function formatBashApproveList(plugin: Plugin, commMessage: Message): string {
  const ent = getEntry(plugin, commMessage);
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
export function listOwnerApproveAlways(plugin: Plugin, commMessage: Message): string[] {
  const ent = getEntry(plugin, commMessage);
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

function pendingKey(adapter: string, endpointId: string, ownerId: string): string {
  return `${adapter}|${endpointId}|${ownerId}`;
}

export function getPendingOrchestrationCount(): number {
  return pendingOrchestration.size;
}

export function evictPendingOrchestrationIfOverPressure(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, value] of pendingOrchestration) {
    if (now > value.expiresAt) {
      pendingOrchestration.delete(key);
      removed++;
    }
  }
  return removed;
}

export function setPendingOrchestrationTool(plugin: Plugin, commMessage: Message, toolName: string): void {
  if (toolName !== OWNER_APPROVE_ALWAYS_TOOL) return;
  if (!commMessage.$adapter || !commMessage.$endpoint) return;
  const ownerId = getEndpointMaster(plugin, commMessage);
  if (ownerId == null) return;
  pendingOrchestration.set(pendingKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId), {
    toolName: OWNER_APPROVE_ALWAYS_TOOL,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
}

export function clearPendingOrchestrationTool(plugin: Plugin, commMessage: Message): void {
  if (!commMessage.$adapter || !commMessage.$endpoint) return;
  const ownerId = getEndpointMaster(plugin, commMessage);
  if (ownerId == null) return;
  pendingOrchestration.delete(pendingKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId));
}

export function getPendingOrchestrationTool(plugin: Plugin, commMessage: Message): string | undefined {
  if (!commMessage.$adapter || !commMessage.$endpoint) return undefined;
  const ownerId = getEndpointMaster(plugin, commMessage);
  if (ownerId == null) return undefined;
  const key = pendingKey(String(commMessage.$adapter), commMessage.$endpoint, ownerId);
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
