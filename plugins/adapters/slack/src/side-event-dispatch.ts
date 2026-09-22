import { composeSideEventName, buildNotice, mapNoticeParts, senderFromId, SLACK_NOTICE_PARTS_MAP } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import { slackInboundConversation, type SlackEvent } from './protocol.js';

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
  const item = asRecord(record.item);
  const channel = stringField(record.channel) ?? stringField(item.channel);
  const user = stringField(record.user) ?? stringField(asRecord(record.user).id);
  const conversation = channel ? slackInboundConversation(endpointKey, {
    channelId: channel,
    channelType: stringField(record.channel_type) ?? stringField(item.channel_type),
    threadId: stringField(record.thread_ts),
  }) : undefined;
  const sceneType = parts.scene_type === 'group' && conversation?.kind === 'private'
    ? 'friend' : parts.scene_type;
  const memberEvent = eventType === 'member_joined_channel' || eventType === 'member_left_channel' || eventType === 'team_join';
  const reactionEvent = eventType === 'reaction_added' || eventType === 'reaction_removed';
  const dedupeKey = [
    eventType,
    channel ?? '',
    user ?? '',
    String(record.ts ?? record.event_ts ?? ''),
  ].join(':');
  void emit('notice.receive', buildNotice(record, {
    id: `slack:${dedupeKey}`,
    clientAdapter: 'slack',
    endpointId: configId,
    type: 'notice',
    conversation,
    name: composeSideEventName('notice', sceneType, parts.sub_type),
    actor: memberEvent ? undefined : senderFromId(user),
    target: senderFromId(
      memberEvent ? user : stringField(record.item_user),
    ),
    messageId: reactionEvent ? stringField(item.ts) : stringField(record.deleted_ts),
    reaction: reactionEvent ? stringField(record.reaction) : undefined,
    operation: reactionEvent ? (eventType === 'reaction_removed' ? 'removed' : 'added') : undefined,
    timestamp: toMillis(record.event_ts ?? record.ts),
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
