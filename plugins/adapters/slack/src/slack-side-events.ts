/**
 * Slack 事件 → zhin Notice 映射
 */
import { mapNoticeParts, buildNotice, senderFromId } from 'zhin.js';
import type { SlackEvent } from './types.js';

export function isSlackNoticeEvent(eventType: string): boolean {
  return SLACK_NOTICE_EVENT_TYPES.has(eventType);
}

const SLACK_NOTICE_EVENT_TYPES = new Set([
  'member_joined_channel',
  'member_left_channel',
  'reaction_added',
  'reaction_removed',
  'message_deleted',
  'channel_archive',
  'channel_unarchive',
  'channel_rename',
  'channel_created',
  'channel_deleted',
  'pin_added',
  'pin_removed',
  'app_home_opened',
  'team_join',
]);

export function formatSlackNotice(
  event: SlackEvent,
  endpointName: string,
) {
  const eventType = event.type;
  const { scene_type, sub_type } = mapNoticeParts('slack', eventType);

  const channelId = resolveNoticeChannelId(event);
  const ts = event.event_ts
    ? parseFloat(event.event_ts) * 1000
    : Date.now();

  const actorId = event.user ?? (event as any).inviter;
  const targetId =
    (event as any).item_user ??
    (event as any).user ??
    undefined;

  return buildNotice(event, {
    $id: resolveSlackSideEventDedupeKey(event),
    $adapter: 'slack',
    $endpoint: endpointName,
    $type: 'notice',
    $scene_id: channelId,
    $scene_type: scene_type,
    $sub_type: sub_type,
    $actor: senderFromId(actorId),
    $target: actorId !== targetId ? senderFromId(targetId) : undefined,
    $timestamp: ts,
  });
}

export function resolveSlackSideEventDedupeKey(event: SlackEvent): string {
  const ts = event.event_ts ?? event.ts ?? '';
  const type = event.type;
  const channel = event.channel ?? '';
  const user = event.user ?? '';
  return `slack:${ts}_${type}_${channel}_${user}`;
}

function resolveNoticeChannelId(event: SlackEvent): string {
  if (event.channel) return String(event.channel);
  const item = (event as any).item;
  if (item?.channel) return String(item.channel);
  const channel = (event as any).channel_id ?? (event as any).channel?.id;
  return channel ? String(channel) : '';
}
