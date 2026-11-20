/**
 * zhinjs/zhin#1250: a button or prompt answer from someone it is not for — a clicker without the
 * button's permit, or a bystander pressing another sender's confirmation — is refused silently in a
 * group or channel (no reply, nothing runs), so bystanders cannot flood the conversation; a private
 * chat still says why. The refusal is the message's `permission_denied` outcome either way.
 *
 * Internal module: not re-exported from the runtime index. The Agent ingress and the instance's chat
 * commands apply the same rule to their own refusals.
 */
import type { SendContent } from './contracts.js';
import { reportInboundOutcome } from './inbound-outcome-ledger.js';

interface RefusedInteractionMessage {
  readonly conversation: { readonly kind: string };
  $reply(content: SendContent): Promise<unknown>;
}

/** Records the refusal and replies `text` only in a private chat. */
export async function refuseInteraction(message: RefusedInteractionMessage, text: SendContent, reason: string): Promise<void> {
  const quiet = message.conversation.kind !== 'private';
  reportInboundOutcome(message, { outcome: 'permission_denied', reason, stage: 'interaction', reply: quiet ? 'no' : 'yes' });
  if (!quiet) await message.$reply(text);
}
