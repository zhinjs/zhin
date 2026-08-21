import { buildNotice, senderFromId } from '@zhin.js/core';
import type { SideEventGateway } from '@zhin.js/core/runtime';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import {
  isLineLifecycleEvent,
  lineInboundConversation,
  type LineEvent,
} from './protocol.js';

function mapLineLifecycleParts(type: LineEvent['type']): { scene_type: string; sub_type: string } {
  switch (type) {
    case 'follow':
      return { scene_type: 'friend', sub_type: 'increase' };
    case 'unfollow':
      return { scene_type: 'friend', sub_type: 'decrease' };
    case 'join':
      return { scene_type: 'group', sub_type: 'member_increase' };
    case 'leave':
      return { scene_type: 'group', sub_type: 'member_decrease' };
    default:
      return { scene_type: 'line', sub_type: type };
  }
}

export function receiveLineSideEvent(
  sideEvents: SideEventGateway | undefined,
  endpointKey: string,
  configId: string,
  event: LineEvent,
  logger: ReturnType<typeof getAdapterLogger>,
): void {
  if (!sideEvents || !isLineLifecycleEvent(event)) return;
  const parts = mapLineLifecycleParts(event.type);
  const conversation = lineInboundConversation(endpointKey, event.source);
  const userId = event.source.userId || conversation.id;
  void sideEvents.receiveNotice(buildNotice(event, {
    $id: `line:${event.type}:${event.timestamp}:${userId}`,
    $adapter: 'line' as never,
    $endpoint: configId,
    $type: 'notice',
    $scene_id: conversation.id,
    $scene_type: parts.scene_type,
    $sub_type: parts.sub_type,
    $actor: senderFromId(userId),
    $timestamp: event.timestamp,
  })).catch((err) => {
    logger.warn(formatCompact({
      op: 'line_side_event_failed',
      endpoint: configId,
      event: event.type,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
