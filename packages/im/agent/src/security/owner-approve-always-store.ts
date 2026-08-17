/**
 * Owner 对 bash / icqq CLI 的放行策略（持久化 data/owner-approve-always.json）。
 *
 * - **bashAlways**：由 Owner `/approve` 显式持久化的 shell 放行开关（仅 bash 工具链）。
 * - **bashRules**：正则列表；在 exec 策略中若 **整条待检子命令** 匹配任一规则，则视为已放行（不固化解参数，例如 `^icqq\\s+friend\\s+like\\b`）。
 *
 * icqq 子命令：非敏感操作默认直接放行；仅命中 {@link ICQQ_SENSITIVE_SUBCOMMAND_REGEXES} 时需审批，除非 always 或规则匹配。
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Adapter, type Message, type Plugin, hasSenderRole, resolveSubjectRoles, senderRolesFromMessage } from '@zhin.js/core';
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

function normalizeBotKey(adapter: string, endpointKey: string, ownerId: string): string {
  return `${adapter}|${endpointKey}|${ownerId}`;
}

interface OwnerApprovalAddress {
  readonly platform: string;
  readonly endpoint: string;
  readonly ownerId: string;
}

function approvalAddressKey(address: OwnerApprovalAddress): string {
  return normalizeBotKey(address.platform, address.endpoint, address.ownerId);
}

function approvalAddressFromMessage(
  plugin: Plugin | null | undefined,
  message: Message,
): OwnerApprovalAddress | undefined {
  const platform = String(message.$adapter ?? '').trim();
  const endpoint = String(message.$endpoint ?? '').trim();
  const ownerId = getEndpointMaster(plugin, message)?.trim();
  return platform && endpoint && ownerId
    ? Object.freeze({ platform, endpoint, ownerId })
    : undefined;
}

function migrateV1ToV2(data: StoreV1): StoreV2 {
  const out = emptyV2();
  for (const e of data.entries || []) {
    if (typeof e !== 'string') continue;
    const parts = e.split('|');
    if (parts.length !== 4) continue;
    const [adapter, endpointKey, ownerId, scope] = parts;
    if (scope === 'orchestration:bash') {
      const k = normalizeBotKey(adapter, endpointKey, ownerId);
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

export function getEndpointMaster(plugin: Plugin | null | undefined, commMessage: Message): string | undefined {
  const fromExtra = (commMessage as { extra?: { endpointMaster?: unknown } }).extra?.endpointMaster;
  if (fromExtra != null && String(fromExtra).trim() !== '') {
    return String(fromExtra);
  }
  if (!plugin) return undefined;
  const root = plugin.root ?? plugin;
  try {
    const adapter = root.inject(commMessage.$adapter) as Adapter | undefined;
    const endpoint = adapter?.endpoints?.get(commMessage.$endpoint);
    const master = (endpoint?.$config as Record<string, unknown> | undefined)?.master;
    return master != null ? String(master) : undefined;
  } catch {
    return undefined;
  }
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

export function resolveToolRequesterRole(
  plugin: Plugin | null | undefined,
  commMessage: Message,
): ToolRequesterRole {
  const roles = senderRolesFromMessage(commMessage);
  if (commMessage.$sender.isMaster !== undefined || commMessage.$sender.isTrusted !== undefined) {
    if (hasSenderRole(roles, 'master')) return 'master';
    if (hasSenderRole(roles, 'trusted')) return 'trusted';
    return 'other';
  }
  if (plugin) {
    try {
      const resolved = resolveSubjectRoles(plugin.root ?? plugin, commMessage);
      if (hasSenderRole(resolved.roles, 'master')) return 'master';
      if (hasSenderRole(resolved.roles, 'trusted')) return 'trusted';
      return 'other';
    } catch {
      /* fall through */
    }
  }
  if (!commMessage.$adapter || !commMessage.$endpoint || !commMessage.$sender?.id) return 'unknown';
  const senderId = String(commMessage.$sender.id);
  const masterId = getEndpointMaster(plugin, commMessage);
  if (masterId && senderId === String(masterId)) return 'master';
  if (plugin) {
    const trusted = getEndpointTrustedIds(plugin, commMessage);
    if (trusted.includes(senderId)) return 'trusted';
  }
  return 'other';
}

function getEntryAt(address: OwnerApprovalAddress): BashApprovalBotEntry | undefined {
  return readStore().endpoints[approvalAddressKey(address)];
}

function setBashAlwaysAt(address: OwnerApprovalAddress, value: boolean): void {
  const key = approvalAddressKey(address);
  const data = readStore();
  const previous = data.endpoints[key] ?? { bashRules: [] };
  data.endpoints[key] = {
    ...(value ? { bashAlways: true } : {}),
    bashRules: [...(previous.bashRules ?? [])],
  };
  writeStore(data);
}

function addBashApproveRuleAt(
  address: OwnerApprovalAddress,
  pattern: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const trimmed = pattern.trim();
  if (!trimmed) return { ok: false, error: '正则不能为空。' };
  try {
    new RegExp(trimmed);
  } catch (error) {
    return { ok: false, error: `无效正则: ${error instanceof Error ? error.message : String(error)}` };
  }
  const key = approvalAddressKey(address);
  const data = readStore();
  const previous = data.endpoints[key] ?? { bashRules: [] };
  const id = crypto.randomUUID();
  data.endpoints[key] = {
    ...(previous.bashAlways ? { bashAlways: true } : {}),
    bashRules: [...previous.bashRules, { id, pattern: trimmed, createdAt: Date.now() }],
  };
  writeStore(data);
  return { ok: true, id };
}

function removeBashApproveRuleAt(
  address: OwnerApprovalAddress,
  ruleId: string,
): { ok: true } | { ok: false; error: string } {
  const id = ruleId.trim();
  if (!id) return { ok: false, error: '请提供规则 id。' };
  const key = approvalAddressKey(address);
  const data = readStore();
  const entry = data.endpoints[key];
  if (!entry?.bashRules.length) return { ok: false, error: '当前无自定义规则。' };
  const next = entry.bashRules.filter((rule) => rule.id !== id && !rule.id.startsWith(id));
  if (next.length === entry.bashRules.length) {
    return { ok: false, error: `未找到 id 前缀或全名为「${id}」的规则。` };
  }
  data.endpoints[key] = { ...entry, bashRules: next };
  writeStore(data);
  return { ok: true };
}

function formatBashApproveListAt(address: OwnerApprovalAddress): string {
  const entry = getEntryAt(address);
  const rules = entry?.bashRules ?? [];
  if (!entry || (!entry.bashAlways && rules.length === 0)) {
    return 'bash 永久放行: 否\n自定义正则放行: 无';
  }
  return [
    `bash 永久放行: ${entry.bashAlways ? '是' : '否'}`,
    `自定义正则放行 (${rules.length}):`,
    ...rules.map((rule) => `  • [${rule.id.slice(0, 8)}] ${rule.pattern}`),
  ].join('\n');
}

export function getOwnerCommMessageOrUndefined(
  plugin: Plugin | null | undefined,
  message: Message,
): Message | undefined {
  if (message.$channel?.type !== 'private') return undefined;
  const ownerId = getEndpointMaster(plugin, message);
  if (ownerId == null || String(message.$sender.id) !== String(ownerId)) return undefined;
  return message;
}

/** 是否已由 Owner `/approve always bash` 永久放行。 */
export function hasOwnerApproveAlways(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  toolName: string,
): boolean {
  if (toolName !== OWNER_APPROVE_ALWAYS_TOOL) return false;
  const address = approvalAddressFromMessage(plugin, commMessage);
  return address ? !!getEntryAt(address)?.bashAlways : false;
}

export function setBashAlways(plugin: Plugin | null | undefined, commMessage: Message, value: boolean): void {
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (address) setBashAlwaysAt(address, value);
}

export function addOwnerApproveAlways(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  toolName: string,
): { ok: true } | { ok: false; error: string } {
  if (toolName.trim().toLowerCase() !== OWNER_APPROVE_ALWAYS_TOOL) {
    return { ok: false, error: '永久放行仅支持 bash（shell 安全确认）。' };
  }
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (!address) return { ok: false, error: '缺少 platform/endpointKey 或未配置 owner。' };
  setBashAlwaysAt(address, true);
  return { ok: true };
}

export function removeOwnerApproveAlways(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  toolName: string,
): { ok: true } | { ok: false; error: string } {
  if (toolName.trim().toLowerCase() !== OWNER_APPROVE_ALWAYS_TOOL) {
    return { ok: false, error: '仅可撤销 bash 的永久放行。' };
  }
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (!address) return { ok: false, error: '缺少 platform/endpointKey 或未配置 owner。' };
  if (!getEntryAt(address)?.bashAlways) {
    return { ok: false, error: '当前未对 bash 设置永久放行。' };
  }
  setBashAlwaysAt(address, false);
  return { ok: true };
}

export function addBashApproveRule(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  pattern: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (!address) {
    return { ok: false, error: '缺少 platform/endpointKey 或未配置 owner。' };
  }
  return addBashApproveRuleAt(address, pattern);
}

export function removeBashApproveRule(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  ruleId: string,
): { ok: true } | { ok: false; error: string } {
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (!address) {
    return { ok: false, error: '缺少 platform/endpointKey 或未配置 owner。' };
  }
  return removeBashApproveRuleAt(address, ruleId);
}

/** exec 策略：bashAlways 或任一 bashRules 匹配 commandLine */
export function matchesBashOwnerExecBypass(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  commandLine: string,
): boolean {
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (!address) return false;
  const ent = getEntryAt(address);
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

export function formatBashApproveList(plugin: Plugin | null | undefined, commMessage: Message): string {
  const address = approvalAddressFromMessage(plugin, commMessage);
  return address ? formatBashApproveListAt(address) : 'bash 永久放行: 否\n自定义正则放行: 无';
}

export function isIcqqSensitiveSubcommand(fullSubCommand: string): boolean {
  const line = fullSubCommand.trim();
  if (!/^\s*icqq(\s|$)/i.test(line)) return false;
  return ICQQ_SENSITIVE_SUBCOMMAND_REGEXES.some((re) => re.test(line));
}

type Pending = { toolName: string; expiresAt: number };
const pendingOrchestration = new Map<string, Pending>();

function setPendingAt(address: OwnerApprovalAddress): void {
  pendingOrchestration.set(approvalAddressKey(address), {
    toolName: OWNER_APPROVE_ALWAYS_TOOL,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
}

function clearPendingAt(address: OwnerApprovalAddress): void {
  pendingOrchestration.delete(approvalAddressKey(address));
}

function getPendingAt(address: OwnerApprovalAddress): string | undefined {
  const key = approvalAddressKey(address);
  const pending = pendingOrchestration.get(key);
  if (!pending || pending.toolName !== OWNER_APPROVE_ALWAYS_TOOL) {
    if (pending) pendingOrchestration.delete(key);
    return undefined;
  }
  if (Date.now() > pending.expiresAt) {
    pendingOrchestration.delete(key);
    return undefined;
  }
  return pending.toolName;
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

export function setPendingOrchestrationTool(
  plugin: Plugin | null | undefined,
  commMessage: Message,
  toolName: string,
): void {
  if (toolName !== OWNER_APPROVE_ALWAYS_TOOL) return;
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (address) setPendingAt(address);
}

export function clearPendingOrchestrationTool(
  plugin: Plugin | null | undefined,
  commMessage: Message,
): void {
  const address = approvalAddressFromMessage(plugin, commMessage);
  if (address) clearPendingAt(address);
}

export function getPendingOrchestrationTool(
  plugin: Plugin | null | undefined,
  commMessage: Message,
): string | undefined {
  const address = approvalAddressFromMessage(plugin, commMessage);
  return address ? getPendingAt(address) : undefined;
}

function usageLines(): string {
  return [
    '用法（bash / icqq）：',
    '  /approve always bash     — 永久跳过 bash 的 Owner 硬确认',
    '  /approve always         — 同上；须在近期 bash 私聊待确认窗口内',
    '  /approve rule <正则>   — 为敏感 icqq 命令增加放行规则（匹配整段子命令）',
    '  /approve list           — 列出永久放行与规则 id',
    '  /approve revoke rule <id> — 删除一条规则（id 可用 list 前 8 位）',
    '  /approve revoke         — 撤销 bash 永久放行（不删规则）',
  ].join('\n');
}

const LINE_TERMINATOR_RE = /[\n\r\u2028\u2029]/u;
/**
 * 线性解析 `/approve rule <内容>`，返回捕获内容（未 trim），不匹配返回 null。
 * 语义等价于正则 `/^\/approve\s+rule\s+(.+)$/iu`（无 m 时 `$` 仅匹配全文末尾、
 * `.` 不含换行符；`\s+` 贪婪、必要时回退一个非换行空白给 `.+`），
 * 但避免 `\s+` 与 `.+` 在空白字符上的量词重叠回溯（js/polynomial-redos）。
 */
function matchApproveRuleArgument(text: string): string | null {
  const head = /^\/approve\s+rule/iu.exec(text);
  if (!head) return null;
  const wsStart = head[0].length;
  let wsEnd = wsStart;
  while (wsEnd < text.length && /\s/u.test(text[wsEnd]!)) wsEnd += 1;
  if (wsEnd === wsStart) return null; // `rule` 后必须跟 \s+
  const rest = text.slice(wsEnd);
  // 捕获段必须延伸到全文末尾且不含换行符，否则任何切分点都不可能匹配。
  if (LINE_TERMINATOR_RE.test(rest)) return null;
  if (rest.length > 0) return rest;
  // 剩余全是空白：`\s+` 回退一个字符给 `.+`（该字符不能是换行符）。
  if (wsEnd - wsStart >= 2) {
    const last = text[wsEnd - 1]!;
    if (!LINE_TERMINATOR_RE.test(last)) return last;
  }
  return null;
}

export interface OwnerApprovalCommandContext {
  readonly platform: string;
  readonly endpoint: string;
  readonly ownerId?: string;
  readonly subjectId: string;
  readonly scope: 'private' | 'group' | 'channel';
}

function ownerCommandAddress(context: OwnerApprovalCommandContext): OwnerApprovalAddress | undefined {
  if (!context.platform || !context.endpoint || !context.ownerId) return undefined;
  return Object.freeze({
    platform: context.platform,
    endpoint: context.endpoint,
    ownerId: context.ownerId,
  });
}

/**
 * Plugin Runtime Owner `/approve` 命令面（无 host Plugin / CommandFeature）。
 * @returns reply text when handled; null when not an approve command.
 */
export function handleRuntimeOwnerApproveCommand(
  context: OwnerApprovalCommandContext,
  rawText: string,
): string | null {
  const text = rawText.trim();
  if (!/^\/approve(?:\s|$)/iu.test(text)) return null;

  if (context.scope !== 'private' || !context.ownerId || context.subjectId !== context.ownerId) {
    return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。需在插件配置中设置 master/owner。';
  }

  if (/^\/approve\s+always\s+bash\s*$/iu.test(text)) {
    const address = ownerCommandAddress(context);
    if (!address) {
      return `⚠️ 当前 Endpoint 未配置 owner\n${usageLines()}`;
    }
    setBashAlwaysAt(address, true);
    return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。后续 bash 需确认时将不再弹窗；若当前仍有一条待回复的 bash 确认，本轮仍需输入 yes。';
  }

  if (/^\/approve\s+always\s*$/iu.test(text)) {
    const address = ownerCommandAddress(context);
    const pending = address ? getPendingAt(address) : undefined;
    if (!pending) {
      return `⚠️ 无近期 bash 待确认上下文，请使用：/approve always bash。\n${usageLines()}`;
    }
    setBashAlwaysAt(address!, true);
    clearPendingAt(address!);
    return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。';
  }

  const revokeRule = text.match(/^\/approve\s+revoke\s+rule\s+(\S+)\s*$/iu);
  if (revokeRule) {
    const address = ownerCommandAddress(context);
    const r = address
      ? removeBashApproveRuleAt(address, revokeRule[1]!)
      : { ok: false as const, error: '缺少 platform/endpointKey 或未配置 owner。' };
    if (!r.ok) return `⚠️ ${r.error}`;
    return '✅ 已删除该放行规则。';
  }

  const ruleArgument = matchApproveRuleArgument(text);
  if (ruleArgument !== null) {
    const address = ownerCommandAddress(context);
    const r = address
      ? addBashApproveRuleAt(address, ruleArgument.trim())
      : { ok: false as const, error: '缺少 platform/endpointKey 或未配置 owner。' };
    if (!r.ok) return `⚠️ ${r.error}`;
    return `✅ 已添加规则 id=${r.id.slice(0, 8)}… ，匹配子命令时将不再要求 Owner 确认（仍受危险命令黑名单等约束）。`;
  }

  if (/^\/approve\s+list\s*$/iu.test(text)) {
    const address = ownerCommandAddress(context);
    return address ? formatBashApproveListAt(address) : 'bash 永久放行: 否\n自定义正则放行: 无';
  }

  if (/^\/approve\s+revoke\s*$/iu.test(text)) {
    const address = ownerCommandAddress(context);
    const entry = address ? getEntryAt(address) : undefined;
    if (!entry?.bashAlways) return '⚠️ 当前未对 bash 设置永久放行。';
    setBashAlwaysAt(address!, false);
    return '✅ 已撤销 bash 永久放行（正则规则仍保留，可用 /approve list 查看）。';
  }

  return `⚠️ 无法解析指令。\n${usageLines()}`;
}
