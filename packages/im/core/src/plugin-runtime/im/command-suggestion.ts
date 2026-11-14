import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message } from './contracts.js';
import { gatedCommandIndex } from './feature-gate.js';

/**
 * "No such command, did you mean …" for a message that did not route (issue #1250).
 *
 * Only a message addressed to the Bot (private chat, an @mention of the Bot, or a configured
 * command prefix the message uses) is considered, so ambient group chat that merely starts
 * with a word resembling a command is left alone. The reply goes out through the ordinary
 * inbound reply path (`$replyFrom`), never a parallel send.
 */
export async function suggestCommandReply(
  message: Message,
  snapshot: RuntimeSnapshot,
  prefix: string,
): Promise<string | undefined> {
  const commands = gatedCommandIndex(message, snapshot);
  if (!commands) return undefined;
  let text = message.content.trim();
  if (message.conversation.kind !== 'private') text = text.replace(/^(?:@\S+\s+)+/u, '').trim();
  if (prefix) {
    if (!text.startsWith(prefix)) return undefined;
    text = text.slice(prefix.length).trim();
  } else if (message.conversation.kind !== 'private' && message.mentioned !== true) {
    return undefined;
  }
  if (!text) return undefined;
  return commands.suggestReply(text, { source: message, commandPrefix: prefix, snapshot });
}
