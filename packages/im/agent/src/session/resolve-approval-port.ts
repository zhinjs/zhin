import type { Message } from '@zhin.js/core';
import type { HttpApprovalAdapter } from './http-approval-adapter.js';
import type { ApprovalPort } from './approval-port.js';

export function readHttpSessionId(commMessage: Message): string | undefined {
  const extra = (commMessage as { extra?: Record<string, unknown> }).extra;
  return typeof extra?.httpSessionId === 'string' ? extra.httpSessionId : undefined;
}

/** Resolve only explicitly installed approval authorities; absence is denial. */
export function resolveApprovalPort(
  commMessage: Message,
  httpApprovalAdapter?: HttpApprovalAdapter,
  defaultApprovalPort?: ApprovalPort,
): ApprovalPort | undefined {
  if (readHttpSessionId(commMessage) && httpApprovalAdapter) return httpApprovalAdapter;
  if (defaultApprovalPort && defaultApprovalPort.available !== false) return defaultApprovalPort;
  return undefined;
}
