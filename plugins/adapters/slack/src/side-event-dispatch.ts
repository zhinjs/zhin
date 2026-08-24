import { buildNotice, mapNoticeParts, senderFromId, SLACK_NOTICE_PARTS_MAP } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import type { SlackEvent } from './protocol.js';

export function receiveSlackSideEvent(
  emit: EndpointEventEmitter,
  endpointKey: string,
  configId: string,
  event: SlackEvent,
  logger: ReturnType<typeof getAdapterLogger>,
): void {
  if (!emit) return;
  const eventType = String(event.type ?? '');
  if (!Object.prototype.hasOwnProperty.call(SLACK_NOTICE_PARTS_MAP, eventType)) return;
  const record = event as Record<string, unknown>;
  const parts = mapNoticeParts('slack', eventType);
  const channel = typeof record.channel === 'string' ? record.channel : undefined;
  const user = typeof record.user === 'string' ? record.user : undefined;
  const sceneId = channel ?? user ?? configId;
  const dedupeKey = [
    eventType,
    channel ?? '',
    user ?? '',
    String(record.ts ?? record.event_ts ?? ''),
  ].join(':');
  void emit('notice.receive', buildNotice(record, {
    $id: `slack:${dedupeKey}`,
    $adapter: 'slack' as never,
    $endpoint: configId,
    $type: 'notice',
    $scene_id: sceneId,
    $scene_type: parts.scene_type,
    $sub_type: parts.sub_type,
    $actor: senderFromId(user),
    $target: senderFromId(
      typeof record.item_user === 'string' ? record.item_user : undefined,
    ),
    $timestamp: toMillis(record.event_ts ?? record.ts),
  })).catch((err) => {
    logger.warn(formatCompact({
      op: 'slack_side_event_failed',
      endpoint: configId,
      event: eventType,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}

function toMillis(time: unknown): number {
  const value = Number(time);
  if (!Number.isFinite(value) || value <= 0) return Date.now();
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}
