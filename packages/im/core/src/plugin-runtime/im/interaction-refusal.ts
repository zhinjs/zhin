/**
 * zhinjs/zhin#1250: a button or prompt answer from someone it is not for — a clicker without the
 * button's permit, or a bystander pressing another sender's confirmation — is refused silently in a
 * group or channel (no reply, nothing runs), so bystanders cannot flood the conversation; a private
 * chat still says why. The refusal is the message's `permission_denied` outcome either way.
 *
 * A command whose own `permit` the sender does not meet is refused the same way
 * ({@link silencesCommandDenial}).
 *
 * Internal module: not re-exported from the runtime index. The Agent ingress and the instance's chat
 * commands apply the same rule to their own refusals.
 */
import { parsePermitName } from '@zhin.js/permission';
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

/** Permit kinds that are conditions on the sender (zhin role, platform standing, user id). */
const SENDER_PERMIT_KINDS: ReadonlySet<string> = new Set(['role', 'platform', 'platform-role', 'platform-permission', 'user']);

/**
 * zhinjs/zhin#1250: whether a command refused for its `permit` stays silent — in a group or channel,
 * when the unmet permit is a condition on the sender (`trusted`, `owner@global`, `platform:admin`,
 * `user(…)`; a custom permit cannot be told apart and counts as one). A condition on the place
 * (`private()`, `group()`, `adapter(…)`) or on the Bot (`bot:admin`) is still answered: it says the
 * command cannot run here, for anyone. The command index names a sender condition first when the
 * sender fails one too, so a bystander is silent even where a place condition also fails.
 * A denial without a named permit (no permission host, no sender) is answered.
 */
export function silencesCommandDenial(conversation: { readonly kind: string }, permit: string | undefined): boolean {
  if (conversation.kind === 'private' || !permit) return false;
  const parsed = parsePermitName(permit);
  return parsed ? SENDER_PERMIT_KINDS.has(parsed.kind) : true;
}
