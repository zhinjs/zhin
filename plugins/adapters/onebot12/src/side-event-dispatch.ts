import { receiveOneBotLikeSideEvent } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import type { OneBot12Event } from './protocol.js';

export interface OneBot12SideEventCaller {
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Exact instance-owned dependencies for one canonical side-event projection. */
export interface OneBot12SideEventContext {
  readonly emit: EndpointEventEmitter;
  readonly endpointKey: string;
  readonly caller: OneBot12SideEventCaller;
  readonly logger: ReturnType<typeof getAdapterLogger>;
}
export function receiveOneBot12SideEvent(raw: OneBot12Event, context: OneBot12SideEventContext): void {
  const { emit, endpointKey, caller, logger } = context;
  if (!emit) return;
  const record = raw as Record<string, unknown>;
  const eventType = String(record.type ?? record.post_type ?? '');
  const detailType = String(record.detail_type ?? '');
  const isRequest = eventType === 'request' || eventType.startsWith('request.');
  const isFriend = detailType.includes('friend') || String(record.request_type ?? '') === 'friend';
  void receiveOneBotLikeSideEvent(emit, {
    adapter: 'onebot12',
    endpointKey,
    platform: 'onebot',
    raw: record,
    ...(isRequest ? {
      approve: async (flag, remark) => {
        await (isFriend
          ? caller.callApi('set_friend_add_request', { flag, approve: true, remark })
          : caller.callApi('set_group_add_request', { flag, approve: true, reason: remark }));
      },
      reject: async (flag, reason) => {
        await (isFriend
          ? caller.callApi('set_friend_add_request', { flag, approve: false })
          : caller.callApi('set_group_add_request', { flag, approve: false, reason }));
      },
    } : {}),
  }).catch((err) => {
    logger.warn(formatCompact({
      op: 'onebot12_side_event_failed',
      endpoint: endpointKey,
      type: eventType || undefined,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
