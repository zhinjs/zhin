import { receiveOneBotLikeSideEvent } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import type { NapCatEvent } from './protocol.js';

export interface NapCatSideEventCaller {
  callApi(action: string, params?: Record<string, unknown>): Promise<unknown>;
}

export function receiveNapCatSideEvent(
  emit: EndpointEventEmitter,
  endpointKey: string,
  caller: NapCatSideEventCaller,
  raw: NapCatEvent,
  logger: ReturnType<typeof getAdapterLogger>,
): void {
  if (!emit) return;
  const record = raw as Record<string, unknown>;
  const postType = String(record.post_type ?? '');
  const requestType = String(record.request_type ?? '');
  const isRequest = postType === 'request' || postType.startsWith('request.');
  const isFriend = requestType === 'friend' || postType.includes('friend');
  void receiveOneBotLikeSideEvent(emit, {
    adapter: 'napcat',
    endpointKey,
    platform: 'napcat',
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
      op: 'napcat_side_event_failed',
      endpoint: endpointKey,
      post_type: postType || undefined,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
