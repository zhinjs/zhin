import { checkBuiltinPermit, type PermissionSubject } from '@zhin.js/permission';
import type { ModerationConfig } from './types.js';

export interface BypassInput {
  readonly sender?: string;
  readonly conversationId: string;
  /**
   * The message projected for the shared permit evaluator (`toPermissionSubject(message)`): zhin
   * chat role (`sender.chatRole`) and platform standing (`sender.platform`), ADR 0056 §5.
   */
  readonly subject?: PermissionSubject;
}

export function shouldBypassInbound(
  config: ModerationConfig,
  input: BypassInput,
): boolean {
  if (!config.enabled || !config.inbound.enabled) return true;

  const sender = input.sender?.trim();
  if (sender) {
    if (config.inbound.whitelist.userIds.includes(sender)) return true;
    const subject = input.subject;
    if (subject && config.inbound.bypass.some(permit => checkBuiltinPermit(permit, subject))) return true;
  }

  if (config.inbound.whitelist.conversationIds.includes(input.conversationId)) {
    return true;
  }

  return false;
}

export function shouldBypassOutbound(config: ModerationConfig): boolean {
  if (!config.enabled || !config.outbound.enabled) return true;
  return config.outbound.bypass === true;
}
