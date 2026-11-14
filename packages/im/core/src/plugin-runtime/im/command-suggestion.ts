import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { Message } from './contracts.js';
import { gatedCommandIndex } from './feature-gate.js';

/**
 * "No such command, did you mean …" for a message that did not route (issue #1250).
 *
 * Only a message addressed to the Bot (private chat, an @mention of the Bot, or a configured
 * command prefix the message uses) is considered, so ambient group chat that merely starts
 * with a word resembling a command is left alone. The reply goes out through the ordinary
 * inbound reply path (`$replyFrom`), never a parallel send. Without a configured prefix the
 * message must also be short and command-like (no question words or marks), and namespace
 * matches (`rss …` for `rss-list`) are off, so questions like `rss 是什么` still reach the AI.
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
  // Only a message that used the configured prefix is an explicit command attempt; private
  // chat and @mentions without one are often questions for the AI (`rss 是什么`).
  return commands.suggestReply(text, { source: message, commandPrefix: prefix, explicitPrefix: prefix.length > 0, snapshot });
}
