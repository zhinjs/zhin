import * as path from 'node:path';
import { hasSenderRole, senderRolesFromMessage, type Message } from '@zhin.js/core';
import { workspaceRoot } from '../discovery/utils.js';
import type { OwnerApprovalAddress } from './owner-approval-contracts.js';
import { OwnerApprovalStore } from './owner-approval-store.js';

export type { OwnerApprovalAddress } from './owner-approval-contracts.js';

export const OWNER_APPROVE_ALWAYS_TOOL = 'bash' as const;
const STORE_FILE = 'owner-approve-always.json';

export type ToolRequesterRole = 'master' | 'trusted' | 'other' | 'unknown';

export interface OwnerApprovalCommandContext {
  readonly platform: string;
  readonly endpoint: string;
  readonly ownerId?: string;
  readonly subjectId: string;
  readonly scope: 'private' | 'group' | 'channel';
}

export class OwnerApprovalRuntime {
  readonly #store: OwnerApprovalStore;

  constructor(workspaceDir?: string) {
    const root = workspaceDir ? path.resolve(workspaceDir) : workspaceRoot();
    this.#store = new OwnerApprovalStore(path.join(root, 'data', STORE_FILE));
  }

  has(address: OwnerApprovalAddress, toolName: string): boolean {
    return toolName === OWNER_APPROVE_ALWAYS_TOOL && this.#store.entry(address)?.bashAlways === true;
  }

  setBashAlways(address: OwnerApprovalAddress, value: boolean): void {
    this.#store.setBashAlways(address, value);
  }

  addBashRule(address: OwnerApprovalAddress, pattern: string) {
    return this.#store.addBashRule(address, pattern);
  }

  removeBashRule(address: OwnerApprovalAddress, ruleId: string) {
    return this.#store.removeBashRule(address, ruleId);
  }

  matchesBashBypass(address: OwnerApprovalAddress, commandLine: string): boolean {
    const entry = this.#store.entry(address);
    if (!entry) return false;
    if (entry.bashAlways) return true;
    const line = commandLine.trim();
    if (!line) return false;
    return entry.bashRules.some((rule) => new RegExp(rule.pattern).test(line));
  }

  format(address: OwnerApprovalAddress): string {
    const entry = this.#store.entry(address);
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

  handleCommand(context: OwnerApprovalCommandContext, rawText: string): string | null {
    const text = rawText.trim();
    if (!/^\/approve(?:\s|$)/iu.test(text)) return null;
    const address = ownerCommandAddress(context);
    if (context.scope !== 'private' || !address || context.subjectId !== address.ownerId) {
      return '⚠️ 仅 Endpoint Owner 可在私聊中使用此指令。需在插件配置中设置 master/owner。';
    }

    if (/^\/approve\s+always\s+bash\s*$/iu.test(text)) {
      this.setBashAlways(address, true);
      return '✅ 已对 bash 永久放行 Owner 硬确认（本 Bot）。后续 bash 需确认时将不再弹窗。';
    }

    const revokeRule = text.match(/^\/approve\s+revoke\s+rule\s+(\S+)\s*$/iu);
    if (revokeRule) {
      const result = this.removeBashRule(address, revokeRule[1]!);
      return result.ok ? '✅ 已删除该放行规则。' : `⚠️ ${result.error}`;
    }

    const ruleArgument = matchApproveRuleArgument(text);
    if (ruleArgument !== null) {
      const result = this.addBashRule(address, ruleArgument.trim());
      return result.ok
        ? `✅ 已添加规则 id=${result.id.slice(0, 8)}… ，匹配子命令时将不再要求 Owner 确认（仍受危险命令黑名单等约束）。`
        : `⚠️ ${result.error}`;
    }

    if (/^\/approve\s+list\s*$/iu.test(text)) return this.format(address);

    if (/^\/approve\s+revoke\s*$/iu.test(text)) {
      if (!this.has(address, OWNER_APPROVE_ALWAYS_TOOL)) return '⚠️ 当前未对 bash 设置永久放行。';
      this.setBashAlways(address, false);
      return '✅ 已撤销 bash 永久放行（正则规则仍保留，可用 /approve list 查看）。';
    }

    return `⚠️ 无法解析指令。\n${usageLines()}`;
  }
}

export function ownerApprovalAddressFromMessage(message: Message): OwnerApprovalAddress | undefined {
  const platform = String(message.$adapter ?? '').trim();
  const endpoint = String(message.$endpoint ?? '').trim();
  const ownerId = String(
    (message as { extra?: { endpointMaster?: unknown } }).extra?.endpointMaster ?? '',
  ).trim();
  return platform && endpoint && ownerId
    ? Object.freeze({ platform, endpoint, ownerId })
    : undefined;
}

export function resolveToolRequesterRole(message: Message): ToolRequesterRole {
  const roles = senderRolesFromMessage(message);
  if (message.$sender.isMaster !== undefined || message.$sender.isTrusted !== undefined) {
    if (hasSenderRole(roles, 'master')) return 'master';
    if (hasSenderRole(roles, 'trusted')) return 'trusted';
    return 'other';
  }
  if (!message.$adapter || !message.$endpoint || !message.$sender?.id) return 'unknown';
  const address = ownerApprovalAddressFromMessage(message);
  return address && String(message.$sender.id) === address.ownerId ? 'master' : 'other';
}

export const ICQQ_SENSITIVE_SUBCOMMAND_REGEXES: readonly RegExp[] = [
  /\bicqq\s+friend\s+(?:delete|block|move)\b/i,
  /\bicqq\s+group\s+(?:kick|mute|set|admin|announce|transfer|quit|dissolve|invite)\b/i,
  /\bicqq\s+(?:request|wallet|pay|recall)\b/i,
  /\bicqq\s+file\s+(?:upload|delete)\b/i,
  /\bicqq\s+gfs\b.*\b(?:rm|delete|del)\b/i,
];

export function isIcqqSensitiveSubcommand(fullSubCommand: string): boolean {
  const line = fullSubCommand.trim();
  return /^\s*icqq(?:\s|$)/i.test(line)
    && ICQQ_SENSITIVE_SUBCOMMAND_REGEXES.some((pattern) => pattern.test(line));
}

function ownerCommandAddress(context: OwnerApprovalCommandContext): OwnerApprovalAddress | undefined {
  if (!context.platform || !context.endpoint || !context.ownerId) return undefined;
  return Object.freeze({
    platform: context.platform,
    endpoint: context.endpoint,
    ownerId: context.ownerId,
  });
}

function usageLines(): string {
  return [
    '用法（bash / icqq）：',
    '  /approve always bash     — 永久跳过 bash 的 Owner 硬确认',
    '  /approve rule <正则>   — 为敏感 icqq 命令增加放行规则（匹配整段子命令）',
    '  /approve list           — 列出永久放行与规则 id',
    '  /approve revoke rule <id> — 删除一条规则（id 可用 list 前 8 位）',
    '  /approve revoke         — 撤销 bash 永久放行（不删规则）',
  ].join('\n');
}

const LINE_TERMINATOR_RE = /[\n\r\u2028\u2029]/u;

function matchApproveRuleArgument(text: string): string | null {
  const head = /^\/approve\s+rule/iu.exec(text);
  if (!head) return null;
  const whitespaceStart = head[0].length;
  let whitespaceEnd = whitespaceStart;
  while (whitespaceEnd < text.length && /\s/u.test(text[whitespaceEnd]!)) whitespaceEnd += 1;
  if (whitespaceEnd === whitespaceStart) return null;
  const rest = text.slice(whitespaceEnd);
  if (LINE_TERMINATOR_RE.test(rest)) return null;
  if (rest.length > 0) return rest;
  if (whitespaceEnd - whitespaceStart >= 2) {
    const last = text[whitespaceEnd - 1]!;
    if (!LINE_TERMINATOR_RE.test(last)) return last;
  }
  return null;
}
