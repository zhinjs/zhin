/**
 * zhinjs/zhin#1250: how the Agent ingress answers a management / approval / group-rule command from
 * someone without the permission it needs. In a group or channel the bot stays silent — no reply, no
 * execution, and the message does not go on to an AI turn — so bystanders cannot flood the
 * conversation with refusals; in a private chat it still says why (nobody else sees it there).
 * Either way the refusal is the message's `permission_denied` outcome (Console message outcomes).
 *
 * Internal module: deliberately not re-exported from the ingress index.
 */
import { reportInboundOutcome, type Message, type SendContent } from '@zhin.js/core/runtime';

/** A group or channel (anything but a private chat), as the inbound addressing rule reads it. */
export function quietForUnauthorized(message: Pick<Message, 'conversation'>): boolean {
  return message.conversation.kind !== 'private';
}

export interface UnauthorizedReplyInput {
  readonly message: Pick<Message, 'conversation'>;
  /** The refusal text a private chat receives. */
  readonly text: SendContent;
  /** Closed refusal code kept on the outcome (for example `not_operator`). */
  readonly reason: string;
  readonly reply: (content: SendContent) => Promise<unknown>;
  /** The management command, for the outcome record. */
  readonly command?: string;
}

/**
 * Records the `permission_denied` outcome and replies only in a private chat. Returns whether a
 * reply was sent; the caller stops the message either way (the command was handled).
 */
export async function respondToUnauthorized(input: UnauthorizedReplyInput): Promise<'replied' | 'silent'> {
  const quiet = quietForUnauthorized(input.message);
  reportInboundOutcome(input.message, {
    outcome: 'permission_denied',
    reason: input.reason,
    stage: 'agent_gate',
    reply: quiet ? 'no' : 'yes',
    ...(input.command ? { command: input.command } : {}),
  });
  if (quiet) return 'silent';
  await input.reply(input.text);
  return 'replied';
}
