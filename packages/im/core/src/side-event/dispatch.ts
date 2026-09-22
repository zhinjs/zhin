import { composeSideEventName, sideEventConversation } from './base.js';
import type { EndpointEventEmitter } from '@zhin.js/adapter';
import {
  buildNotice,
  buildRequest,
  buildSystem,
  mapNoticeParts,
  mapRequestParts,
  resolveSideEventDedupeKey,
  senderFromId,
  type OneBotLikeRawEvent,
  type SideEventPlatform,
} from './normalize.js';

export interface OneBotLikeSideEventInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly platform?: SideEventPlatform;
  readonly raw: OneBotLikeRawEvent;
  readonly approve?: (flag: string, remark?: string) => void | Promise<void>;
  readonly reject?: (flag: string, reason?: string) => void | Promise<void>;
}

/**
 * Normalize OneBot / icqq-style notice|request|meta payloads and feed Endpoint.emit().
 * Returns which kind was dispatched, or null when the payload is not a side event.
 */
export async function receiveOneBotLikeSideEvent(
  emit: EndpointEventEmitter,
  input: OneBotLikeSideEventInput,
): Promise<'notice' | 'request' | 'system' | null> {
  const raw = input.raw;
  const platform = input.platform ?? 'onebot';
  const postType = String(raw.post_type ?? raw.type ?? '');

  if (postType === 'notice' || postType.startsWith('notice.')) {
    const noticeType = String(
      raw.notice_type ?? (postType.replace(/^notice\.?/, '') || 'unknown'),
    );
    const parts = mapNoticeParts(platform, noticeType, {
      sub_type: raw.sub_type != null ? String(raw.sub_type) : undefined,
      is_group: raw.group_id != null,
    });
    const id = resolveSideEventDedupeKey(raw, 'notice');
    const memberEvent = ['member_increase', 'member_decrease', 'ban', 'admin_change'].includes(parts.sub_type);
    const actorId = raw.operator_id
      ?? (!memberEvent ? raw.user_id : undefined);
    const targetId = memberEvent
      ? raw.user_id
      : parts.sub_type === 'poke'
        ? raw.target_id ?? raw.self_id
        : raw.user_id != null && String(raw.user_id) !== String(raw.operator_id ?? '')
          ? raw.user_id
          : undefined;
    const notice = buildNotice(raw, {
      id,
      clientAdapter: input.adapter,
      endpointId: input.endpointKey,
      type: 'notice',
      conversation: oneBotConversation(parts.scene_type, raw),
      name: composeSideEventName('notice', parts.scene_type, parts.sub_type),
      actor: senderFromId(actorId),
      target: senderFromId(targetId),
      timestamp: toMillis(raw.time),
      ...(raw.message_id != null ? { messageId: String(raw.message_id) } : {}),
      ...(raw.emoji_id != null || raw.code != null
        ? { reaction: String(raw.emoji_id ?? raw.code) }
        : {}),
      ...(parts.sub_type === 'emoji_reaction'
        ? { operation: /delete|remove/i.test(String(raw.sub_type ?? noticeType)) ? 'removed' as const : 'added' as const }
        : {}),
      ...(raw.duration != null ? { durationSeconds: Math.max(0, Number(raw.duration) || 0) } : {}),
      ...(parts.sub_type === 'admin_change'
        ? { role: 'admin', enabled: String(raw.sub_type ?? '') === 'set' }
        : {}),
    });
    await emit('notice.receive', notice);
    return 'notice';
  }

  if (postType === 'request' || postType.startsWith('request.')) {
    const requestType = String(
      raw.request_type ?? (postType.replace(/^request\.?/, '') || 'friend'),
    );
    const parts = mapRequestParts(platform, requestType, raw.sub_type != null ? String(raw.sub_type) : undefined);
    const flag = raw.flag != null ? String(raw.flag) : '';
    const id = flag || resolveSideEventDedupeKey(raw, 'request');
    const actor = senderFromId(raw.user_id);
    if (!actor) return null;
    const approve = input.approve;
    const reject = input.reject;
    let active = true;
    const actions = new Set<Promise<void>>();
    const requireActiveAction = () => {
      if (!active) throw new Error('Request action port expired with its generation operation');
    };
    const runAction = (action: () => void | Promise<void>): Promise<void> => {
      requireActiveAction();
      const operation = Promise.resolve().then(action);
      actions.add(operation);
      void operation.then(
        () => actions.delete(operation),
        () => actions.delete(operation),
      );
      return operation;
    };
    const request = buildRequest(raw, {
      id,
      clientAdapter: input.adapter,
      endpointId: input.endpointKey,
      type: 'request',
      conversation: oneBotConversation(parts.scene_type, raw),
      name: composeSideEventName('request', parts.scene_type, parts.sub_type),
      actor,
      comment: raw.comment != null ? String(raw.comment) : undefined,
      timestamp: toMillis(raw.time),
      async $approve(remark?: string) {
        if (!approve || !flag) throw new Error('Request approve is not available');
        await runAction(() => approve(flag, remark));
      },
      async $reject(reason?: string) {
        if (!reject || !flag) throw new Error('Request reject is not available');
        await runAction(() => reject(flag, reason));
      },
    });
    try {
      await emit('request.receive', request);
    } finally {
      active = false;
      await Promise.allSettled([...actions]);
    }
    return 'request';
  }

  if (
    postType === 'meta_event'
    || postType === 'meta'
    || postType.startsWith('meta.')
    || postType.startsWith('system.')
  ) {
    const metaType = String(
      raw.meta_event_type
      ?? raw.detail_type
      ?? (postType.replace(/^(meta_event|meta|system)\.?/, '') || 'unknown'),
    );
    const subType = raw.sub_type != null ? String(raw.sub_type) : undefined;
    const name = postType.startsWith('system.')
      ? postType
      : composeSideEventName('system', metaType, subType);
    const system = buildSystem(raw, {
      id: `system:${toMillis(raw.time)}_${metaType}_${subType ?? ''}`,
      clientAdapter: input.adapter,
      endpointId: input.endpointKey,
      type: 'system',
      name,
      timestamp: toMillis(raw.time),
    });
    await emit('system.receive', system);
    return 'system';
  }

  return null;
}

function oneBotConversation(sceneType: string, raw: OneBotLikeRawEvent) {
  const id = sceneType === 'group' ? raw.group_id
    : sceneType === 'channel' ? raw.channel_id
      : sceneType === 'private' || sceneType === 'friend' ? raw.user_id
        : undefined;
  return sideEventConversation(sceneType, id == null ? '' : String(id));
}

function toMillis(time: unknown): number {
  const seconds = Number(time);
  return Number.isFinite(seconds) && seconds > 0
    ? (seconds < 1e12 ? seconds * 1000 : seconds)
    : Date.now();
}
