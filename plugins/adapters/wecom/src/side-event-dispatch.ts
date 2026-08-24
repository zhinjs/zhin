import { buildNotice, buildSystem, senderFromId } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import { resolveChatType, type WecomMessage } from './protocol.js';

function mapWecomEventParts(eventName: string): { scene_type: string; sub_type: string } | null {
  switch (eventName) {
    case 'subscribe':
      return { scene_type: 'friend', sub_type: 'increase' };
    case 'unsubscribe':
      return { scene_type: 'friend', sub_type: 'decrease' };
    case 'enter_agent':
      return null;
    default:
      return { scene_type: 'wecom', sub_type: eventName || 'unknown' };
  }
}

export function receiveWecomSideEvent(
  emit: EndpointEventEmitter,
  endpointKey: string,
  configId: string,
  msg: WecomMessage,
  logger: ReturnType<typeof getAdapterLogger>,
): boolean {
  if (msg.MsgType !== 'event') return false;
  const eventName = msg.Event ?? 'unknown';
  if (eventName === 'enter_agent') {
    void emit('system.receive', buildSystem(msg, {
      $id: `wecom:enter_agent:${msg.FromUserName}:${msg.CreateTime ?? Date.now()}`,
      $adapter: 'wecom' as never,
      $endpoint: configId,
      $type: 'system',
      $scene_id: msg.FromUserName,
      $scene_type: 'wecom',
      $sub_type: 'enter_agent',
      $timestamp: msg.CreateTime ?? Date.now(),
    })).catch((err) => {
      logger.warn(formatCompact({
        op: 'wecom_system_side_event_failed',
        endpoint: configId,
        event: eventName,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
    return true;
  }
  const parts = mapWecomEventParts(eventName);
  if (!parts) return false;
  const sceneType = resolveChatType(msg.FromUserName);
  void emit('notice.receive', buildNotice(msg, {
    $id: `wecom:${eventName}:${msg.FromUserName}:${msg.CreateTime ?? Date.now()}`,
    $adapter: 'wecom' as never,
    $endpoint: configId,
    $type: 'notice',
    $scene_id: msg.FromUserName,
    $scene_type: parts.scene_type === 'friend' ? parts.scene_type : sceneType,
    $sub_type: parts.sub_type,
    $actor: senderFromId(msg.FromUserName),
    $timestamp: msg.CreateTime ?? Date.now(),
  })).catch((err) => {
    logger.warn(formatCompact({
      op: 'wecom_side_event_failed',
      endpoint: configId,
      event: eventName,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
  return true;
}
