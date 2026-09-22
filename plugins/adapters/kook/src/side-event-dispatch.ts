import { composeSideEventName, buildNotice, mapNoticeParts, senderFromId, KOOK_NOTICE_PARTS_MAP } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import type { KookWebhookEventData } from './protocol.js';

function extractKookNoticeType(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as KookWebhookEventData;
  const extraType = event.extra?.type;
  if (typeof extraType === 'string' && extraType) return extraType;
  if (event.channel_type === 'NOTICE' && event.type != null) {
    return String(event.type);
  }
  return null;
}

export function receiveKookSideEvent(
  emit: EndpointEventEmitter,
  configId: string,
  raw: unknown,
  logger: ReturnType<typeof getAdapterLogger>,
): boolean {
  const noticeType = extractKookNoticeType(raw);
  if (!noticeType) return false;
  if (!Object.prototype.hasOwnProperty.call(KOOK_NOTICE_PARTS_MAP, noticeType)) return false;
  const event = raw as KookWebhookEventData;
  const parts = mapNoticeParts('kook', noticeType);
  const body = event.extra?.body;
  const guildId = event.extra?.guild_id
    ?? (event.channel_type === 'GROUP' && event.type === 255 ? event.target_id : undefined);
  const userId = body?.user_id;
  const memberEvent = noticeType === 'joined_guild' || noticeType === 'exited_guild';
  // Guild ids and private chat_code values are not outbound channel/user ids.
  const channelId = !memberEvent ? body?.channel_id : undefined;
  const conversation = channelId ? {
    kind: 'channel' as const,
    id: channelId,
    ...(guildId ? { parent: { kind: 'channel' as const, id: guildId } } : {}),
  } : undefined;
  const sceneType = conversation ? 'channel'
    : noticeType.includes('private') ? 'friend' : parts.scene_type;
  const sceneId = channelId ?? guildId ?? '';
  const reactionEvent = noticeType.includes('reaction');
  void emit('notice.receive', buildNotice(event, {
    id: `kook:${noticeType}:${event.msg_timestamp ?? Date.now()}:${sceneId}:${String(userId ?? '')}`,
    clientAdapter: 'kook',
    endpointId: configId,
    type: 'notice',
    conversation,
    name: composeSideEventName('notice', sceneType, parts.sub_type),
    actor: memberEvent ? undefined : senderFromId(userId),
    target: memberEvent ? senderFromId(userId) : undefined,
    messageId: body?.msg_id,
    reaction: reactionEvent ? body?.emoji?.id : undefined,
    operation: reactionEvent ? (noticeType.includes('deleted') ? 'removed' : 'added') : undefined,
    timestamp: event.msg_timestamp ?? Date.now(),
  })).catch((err) => {
    logger.warn(formatCompact({
      op: 'kook_side_event_failed',
      endpoint: configId,
      event: noticeType,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
  return true;
}
