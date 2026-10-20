import { createDeliveryTarget, type DeliveryTarget } from 'zhin.js';
import type { CommandMessage } from 'zhin.js/command';

/** The person using a ledger command and where they are talking from. */
export interface LedgerCaller {
  /** Stable per-user key: adapter + endpoint (bot account) + sender id. */
  readonly ownerKey: string;
  readonly senderId: string;
  /** The conversation the command came from. */
  readonly conversation: DeliveryTarget;
  /** The caller's own private conversation with the same bot account. */
  readonly privateTarget: DeliveryTarget;
  /** False in groups and channels, where other people can read replies. */
  readonly isPrivate: boolean;
}

export class LedgerInputError extends Error {}

export function ledgerOwnerKey(adapter: string, endpointId: string, senderId: string): string {
  return JSON.stringify([adapter, endpointId, senderId]);
}

/** Builds the caller from a command message; commands without a real sender are refused. */
export function ledgerCaller(input: CommandMessage | undefined): LedgerCaller {
  const senderId = input?.sender?.id;
  if (!input || !senderId) throw new LedgerInputError('记账需要在真实会话中由具体用户发送');
  const conversation = createDeliveryTarget(input);
  const endpoint = conversation.endpoint;
  const isPrivate = conversation.kind === 'private';
  const privateTarget: DeliveryTarget = isPrivate
    ? conversation
    : Object.freeze({ endpoint, kind: 'private', id: senderId });
  return {
    ownerKey: ledgerOwnerKey(endpoint.adapter, endpoint.id, senderId),
    senderId,
    conversation,
    privateTarget,
    isPrivate,
  };
}

/** Turns expected input problems into a reply and lets real failures surface. */
export async function replyLedger(operation: () => Promise<string>): Promise<string> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LedgerInputError) return error.message;
    throw error;
  }
}
