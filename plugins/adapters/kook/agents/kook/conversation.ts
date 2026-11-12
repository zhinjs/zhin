import type { ToolExecutionContext } from '@zhin.js/tool';
import { messages as t } from './messages.js';

export type KookToolContext = ToolExecutionContext<unknown, 'kook'>;

/**
 * The trusted turn owns the server; model input cannot select another one. Platform (`platform:*` /
 * `platform-permission:*`) and Bot (`bot-permission:*`) permits are judged in the current conversation,
 * so tools that rely on them act on the current server only (ADR 0056 §5).
 */
export function currentGuild(context: KookToolContext): string {
  const { origin } = context;
  const conversation = origin?.kind === 'im' && origin.platform === 'kook' ? origin.conversation : undefined;
  const guildId = conversation?.kind === 'channel' && conversation.parent?.kind === 'channel' ? conversation.parent.id : '';
  if (!guildId) throw new Error(t(context.locale, 'guildRequired'));
  context.signal?.throwIfAborted();
  return guildId;
}
