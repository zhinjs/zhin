import { buildNotice, mapNoticeParts, senderFromId, KOOK_NOTICE_PARTS_MAP } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import type { KookWebhookEventData } from './protocol.js';

function extractKookNoticeType(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as KookWebhookEventData & { extra?: { type?: string } };
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
  const guildId = event.extra?.guild_id;
  const userId = event.author_id ?? event.extra?.author?.id;
  const sceneId = guildId != null
    ? String(guildId)
    : userId != null
      ? String(userId)
      : configId;
  void emit('notice.receive', buildNotice(event, {
    $id: `kook:${noticeType}:${event.msg_timestamp ?? Date.now()}:${sceneId}:${String(userId ?? '')}`,
    $adapter: 'kook' as never,
    $endpoint: configId,
    $type: 'notice',
    $scene_id: sceneId,
    $scene_type: parts.scene_type,
    $sub_type: parts.sub_type,
    $actor: senderFromId(userId, event.extra?.author?.username),
    $timestamp: event.msg_timestamp ?? Date.now(),
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
