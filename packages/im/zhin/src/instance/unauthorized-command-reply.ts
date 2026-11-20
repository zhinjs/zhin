/**
 * zhinjs/zhin#1250: how the instance's chat management commands (`restart`, `feature`, `role`) answer
 * a sender without the permission they need. In a group or channel the command stays silent — no
 * reply and nothing executed (a matched command never reaches an AI turn) — so bystanders cannot
 * flood the conversation with refusals; in a private chat it still says why. Either way the refusal
 * is the message's `permission_denied` outcome (Console message outcomes).
 *
 * The Agent ingress applies the same rule to its own commands (`plugin-runtime/ingress/unauthorized-reply.ts`
 * in `@zhin.js/agent`); neither helper is a public export.
 */
import { reportInboundOutcome } from '@zhin.js/core/runtime';

export interface UnauthorizedCommandReplyInput {
  /** The command's input (the inbound Message); its outcome ledger receives the refusal. */
  readonly input: unknown;
  /** Kind of the conversation the command came from; anything but `private` stays silent. */
  readonly kind: string | undefined;
  /** The refusal a private chat receives. */
  readonly text: string;
  /** Closed refusal code (for example `not-global-owner`). */
  readonly reason: string;
  readonly command: string;
}

/** The command's reply: `text` in a private chat, `undefined` (nothing sent) in a group or channel. */
export function unauthorizedCommandReply(input: UnauthorizedCommandReplyInput): string | undefined {
  const quiet = input.kind !== undefined && input.kind !== 'private';
  reportInboundOutcome(input.input, {
    outcome: 'permission_denied',
    reason: input.reason,
    stage: 'command',
    command: input.command,
    reply: quiet ? 'no' : 'yes',
  });
  return quiet ? undefined : input.text;
}
