import type { ModerationConfig } from './types.js';

export interface BypassInput {
  readonly sender?: string;
  readonly conversationId: string;
  /** The sender's chat role in this conversation (ADR 0056, Runtime-set `sender.chatRole`). */
  readonly chatRole?: 'owner' | 'admin' | 'trusted';
}

const RANK = { trusted: 1, admin: 2, owner: 3 } as const;

export function shouldBypassInbound(
  config: ModerationConfig,
  input: BypassInput,
): boolean {
  if (!config.enabled || !config.inbound.enabled) return true;

  const sender = input.sender?.trim();
  if (sender) {
    if (config.inbound.whitelist.userIds.includes(sender)) return true;
    const bypass = config.inbound.bypassRole;
    if (bypass !== 'none' && input.chatRole && RANK[input.chatRole] >= RANK[bypass]) return true;
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
