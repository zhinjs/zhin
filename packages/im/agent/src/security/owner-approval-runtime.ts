import type { Locale } from '@zhin.js/plugin-runtime';
import { managementCommandText, managementCommandReference, type AgentCommandPresentation } from '../init/command-presentation.js';
import { ownerApprovalMessages as t } from './owner-approval-messages.js';
import * as path from 'node:path';
import { hasSenderRole, senderRolesFromMessage, type Message } from '@zhin.js/core';
import { workspaceRoot } from '../discovery/utils.js';
import type { OwnerApprovalAddress } from './owner-approval-contracts.js';
import { OwnerApprovalStore } from './owner-approval-store.js';

export type { OwnerApprovalAddress } from './owner-approval-contracts.js';

export const OWNER_APPROVE_ALWAYS_TOOL = 'bash' as const;
const STORE_FILE = 'owner-approve-always.json';

export type ToolRequesterRole = 'master' | 'trusted' | 'other' | 'unknown';

export interface OwnerApprovalCommandContext extends AgentCommandPresentation {
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

  addBashRule(address: OwnerApprovalAddress, pattern: string, locale?: Locale) {
    return this.#store.addBashRule(address, pattern, locale);
  }

  removeBashRule(address: OwnerApprovalAddress, ruleId: string, locale?: Locale) {
    return this.#store.removeBashRule(address, ruleId, locale);
  }

  matchesBashBypass(address: OwnerApprovalAddress, commandLine: string): boolean {
    const entry = this.#store.entry(address);
    if (!entry) return false;
    if (entry.bashAlways) return true;
    const line = commandLine.trim();
    if (!line) return false;
    return entry.bashRules.some((rule) => new RegExp(rule.pattern).test(line));
  }

  format(address: OwnerApprovalAddress, locale?: Locale): string {
    const entry = this.#store.entry(address);
    const rules = entry?.bashRules ?? [];
    if (!entry || (!entry.bashAlways && rules.length === 0)) {
      return t(locale, 'empty');
    }
    return [
      t(locale, 'status', { enabled: t(locale, entry.bashAlways ? 'yes' : 'no'), count: rules.length }),
      ...rules.map((rule) => `  • [${rule.id.slice(0, 8)}] ${rule.pattern}`),
    ].join('\n');
  }

  handleCommand(context: OwnerApprovalCommandContext, rawText: string): string | null {
    const text = managementCommandText(rawText, context.commandPrefix);
    if (text === undefined || !/^approve(?:\s|$)/iu.test(text)) return null;
    const locale = context.locale;
    const command = managementCommandReference('approve', context.commandPrefix)!;
    const address = ownerCommandAddress(context);
    if (context.scope !== 'private' || !address || context.subjectId !== address.ownerId) {
      return t(locale, 'denied');
    }

    if (/^approve\s+always\s+bash\s*$/iu.test(text)) {
      this.setBashAlways(address, true);
      return t(locale, 'always');
    }

    const revokeRule = text.match(/^approve\s+revoke\s+rule\s+(\S+)\s*$/iu);
    if (revokeRule) {
      const result = this.removeBashRule(address, revokeRule[1]!, locale);
      return result.ok ? t(locale, 'removed') : `⚠️ ${result.error}`;
    }

    const ruleArgument = matchApproveRuleArgument(text);
    if (ruleArgument !== null) {
      const result = this.addBashRule(address, ruleArgument.trim(), locale);
      return result.ok
        ? t(locale, 'added', { id: result.id.slice(0, 8) })
        : `⚠️ ${result.error}`;
    }

    if (/^approve\s+list\s*$/iu.test(text)) return this.format(address, locale);

    if (/^approve\s+revoke\s*$/iu.test(text)) {
      if (!this.has(address, OWNER_APPROVE_ALWAYS_TOOL)) return t(locale, 'notAlways');
      this.setBashAlways(address, false);
      return t(locale, 'revoked', { command });
    }

    return `${t(locale, 'unknown')}\n${t(locale, 'usage', { command })}`;
  }
}

export function ownerApprovalAddressFromMessage(message: Message): OwnerApprovalAddress | undefined {
  const platform = String(message.clientAdapter ?? message.conversation.endpoint.adapter).trim();
  const endpoint = String(message.endpointId ?? message.conversation.endpoint.id).trim();
  const ownerId = String(
    (message as { extra?: { endpointMaster?: unknown } }).extra?.endpointMaster ?? '',
  ).trim();
  return platform && endpoint && ownerId
    ? Object.freeze({ platform, endpoint, ownerId })
    : undefined;
}

export function resolveToolRequesterRole(message: Message): ToolRequesterRole {
  const roles = senderRolesFromMessage(message);
  if (hasSenderRole(roles, 'master')) return 'master';
  if (hasSenderRole(roles, 'trusted')) return 'trusted';
  if (!message.sender?.id) return 'unknown';
  const address = ownerApprovalAddressFromMessage(message);
  return address && String(message.sender.id) === address.ownerId ? 'master' : 'other';
}

function ownerCommandAddress(context: OwnerApprovalCommandContext): OwnerApprovalAddress | undefined {
  if (!context.platform || !context.endpoint || !context.ownerId) return undefined;
  return Object.freeze({
    platform: context.platform,
    endpoint: context.endpoint,
    ownerId: context.ownerId,
  });
}

const LINE_TERMINATOR_RE = /[\n\r\u2028\u2029]/u;

function matchApproveRuleArgument(text: string): string | null {
  const head = /^approve\s+rule/iu.exec(text);
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
