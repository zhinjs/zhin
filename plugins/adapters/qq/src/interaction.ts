import type { QqInboundMessage } from './protocol.js';

/** qq-official-bot 1.3 normalizes INTERACTION_CREATE to notice.*.action. */
export function normalizeQqInteraction(raw: unknown): { message: QqInboundMessage; sourceMessageId?: string; ack: () => Promise<unknown> } | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as { sub_type?: string; notice_type?: string; notice_id?: string; operator_id?: string; group_id?: string; channel_id?: string; guild_id?: string; data?: { resolved?: { button_data?: unknown; message_id?: unknown; user_id?: string } }; reply?: (code: number) => Promise<unknown> };
  const resolved = event.data?.resolved;
  if (event.sub_type !== 'action' || !event.notice_id || typeof resolved?.button_data !== 'string' || typeof event.reply !== 'function') return null;
  const actor = event.operator_id ?? resolved.user_id;
  const kind = event.notice_type === 'friend' ? 'private' : event.notice_type === 'group' ? 'group' : event.notice_type === 'guild' ? 'channel' : undefined;
  const id = kind === 'private' ? actor : kind === 'group' ? event.group_id : event.channel_id;
  if (!kind || !id || !actor || (kind === 'channel' && !event.guild_id)) return null;
  const sourceMessageId = typeof resolved.message_id === 'string' && resolved.message_id ? resolved.message_id : undefined;
  return { message: { id: event.notice_id, content: '', channelKind: kind, channelId: id, authorId: actor, authorName: '', timestamp: Date.now(), ...(event.guild_id ? { guildId: event.guild_id } : {}), segments: [{ type: 'action', data: { payload: resolved.button_data } }] }, ...(sourceMessageId ? { sourceMessageId } : {}), ack: () => event.reply!(0) };
}
