import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type SlackToolContext = ToolExecutionContext<unknown, 'slack'>;

/**
 * The trusted turn owns the channel; model input cannot select another one. zhin roles are judged
 * along the current conversation's scope chain, so channel administration tools act on the current
 * channel only (ADR 0056 §5).
 */
export function currentChannel(context: SlackToolContext, options: { readonly allowDirect?: boolean } = {}): string {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'slack' ? origin.conversation : undefined;
  if (!conversation || (conversation.kind === 'private' && !options.allowDirect)) throw new Error(t(context.locale, 'channelRequired'));
  context.signal?.throwIfAborted();
  return conversation.id;
}
