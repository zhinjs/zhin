import { composeSideEventName, sideEventConversation, buildNotice, senderFromId } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import { formatInboundId, type WeChatMessage } from './protocol.js';

function mapWeChatMpEventParts(eventName: string): { scene_type: string; sub_type: string } {
  switch (eventName) {
    case 'subscribe':
      return { scene_type: 'friend', sub_type: 'increase' };
    case 'unsubscribe':
      return { scene_type: 'friend', sub_type: 'decrease' };
    default:
      return { scene_type: 'wechat-mp', sub_type: eventName || 'unknown' };
  }
}

export function receiveWeChatMpSideEvent(
  emit: EndpointEventEmitter,
  configId: string,
  msg: WeChatMessage,
  logger: ReturnType<typeof getAdapterLogger>,
): boolean {
  if (msg.MsgType !== 'event') return false;
  const eventName = msg.Event ?? 'unknown';
  const parts = mapWeChatMpEventParts(eventName);
  void emit('notice.receive', buildNotice(msg, {
    id: `wechat-mp:${formatInboundId(msg)}`,
    clientAdapter: 'wechat-mp',
    endpointId: configId,
    type: 'notice',
    conversation: sideEventConversation('private', msg.FromUserName),
    name: composeSideEventName('notice', parts.scene_type, parts.sub_type),
    actor: senderFromId(msg.FromUserName),
    timestamp: Number.isFinite(msg.CreateTime) && msg.CreateTime > 0 ? msg.CreateTime * 1000 : Date.now(),
  })).catch((err) => {
    logger.warn(formatCompact({
      op: 'wechat_mp_side_event_failed',
      endpoint: configId,
      event: eventName,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
  return true;
}
