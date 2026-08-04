/**
 * Resolve SessionInteractionPort from transport context (ADR 0041).
 */
import { type Message, type Plugin } from '@zhin.js/core';
import type { HttpApprovalAdapter } from './http-approval-adapter.js';
import { ImApprovalAdapter } from './im-approval-adapter.js';
import type { ApprovalPort } from './session-interaction-port.js';

export function readHttpSessionId(commMessage: Message): string | undefined {
  const extra = (commMessage as { extra?: Record<string, unknown> }).extra;
  return typeof extra?.httpSessionId === 'string' ? extra.httpSessionId : undefined;
}

export function resolveSessionInteractionPort(
  commMessage: Message,
  plugin: Plugin | undefined,
  httpApprovalAdapter?: HttpApprovalAdapter,
  defaultApprovalPort?: ApprovalPort,
): ApprovalPort | undefined {
  const httpSessionId = readHttpSessionId(commMessage);
  if (httpSessionId && httpApprovalAdapter) {
    return httpApprovalAdapter;
  }
  if (defaultApprovalPort && defaultApprovalPort.available !== false) return defaultApprovalPort;
  if (!plugin) return undefined;
  return new ImApprovalAdapter(plugin, commMessage);
}
