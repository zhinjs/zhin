import type { ModerationConfig } from './types.js';

export interface BypassInput {
  readonly sender?: string;
  readonly conversationId: string;
  /** Endpoint / plugin-declared masters already resolved by caller. */
  readonly endpointMasters?: readonly string[];
}

export function shouldBypassInbound(
  config: ModerationConfig,
  input: BypassInput,
): boolean {
  if (!config.enabled || !config.inbound.enabled) return true;

  const sender = input.sender?.trim();
  if (sender) {
    if (config.inbound.whitelist.userIds.includes(sender)) return true;
    if (config.inbound.bypassMasters) {
      const masters = new Set([
        ...config.masters,
        ...(input.endpointMasters ?? []),
      ].map(String));
      if (masters.has(sender)) return true;
    }
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
