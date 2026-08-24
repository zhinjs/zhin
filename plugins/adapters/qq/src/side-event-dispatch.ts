import { receiveOneBotLikeSideEvent, type OneBotLikeRawEvent } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';

export interface QqSideEventCaller {
  approveGroupJoinRequest?(
    groupId: string,
    userId: string,
    options: { op: 'approve' | 'reject'; join_request_id: string; reason?: string },
  ): Promise<unknown>;
}

const QQ_SIDE_EVENT_NAMES = [
  'notice.group.join_request',
  'notice.group.member',
  'notice.group.member.increase',
  'notice.group.member.decrease',
  'notice.group.increase',
  'notice.group.decrease',
  'notice.guild.member',
  'notice.guild.member.increase',
  'notice.guild.member.decrease',
] as const;

export function bindQqBotSideEvents(
  bot: { on(event: string, listener: (...args: unknown[]) => void): void },
  dispatch: (eventName: string, raw: unknown) => void,
): void {
  for (const name of QQ_SIDE_EVENT_NAMES) {
    bot.on(name, (raw) => dispatch(name, raw));
  }
}

function toOneBotLikeRaw(eventName: string, raw: unknown): OneBotLikeRawEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const asId = (value: unknown): string | number | undefined => {
    if (typeof value === 'string' || typeof value === 'number') return value;
    return undefined;
  };
  const asTime = (value: unknown): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n > 0 ? n : Date.now();
  };
  if (eventName === 'notice.group.join_request') {
    return {
      ...record,
      post_type: 'request',
      request_type: 'group',
      flag: record.join_request_id != null ? String(record.join_request_id) : undefined,
      user_id: asId(record.user_id),
      group_id: asId(record.group_id),
      comment: record.verify_info != null ? String(record.verify_info) : undefined,
      time: asTime(record.timestamp),
    };
  }
  if (eventName.startsWith('notice.')) {
    return {
      ...record,
      post_type: eventName,
      notice_type: eventName.replace(/^notice\./, ''),
      time: asTime(record.timestamp),
    };
  }
  return null;
}

export function receiveQqSideEvent(
  emit: EndpointEventEmitter,
  endpointKey: string,
  caller: QqSideEventCaller,
  eventName: string,
  raw: unknown,
  logger: ReturnType<typeof getAdapterLogger>,
): void {
  if (!emit) return;
  const mapped = toOneBotLikeRaw(eventName, raw);
  if (!mapped) return;
  const isJoinRequest = eventName === 'notice.group.join_request';
  const joinRaw = isJoinRequest && raw && typeof raw === 'object'
    ? raw as { group_id?: string | number; user_id?: string | number; join_request_id?: string | number }
    : undefined;
  void receiveOneBotLikeSideEvent(emit, {
    adapter: 'qq',
    endpointKey,
    platform: 'qq',
    raw: mapped,
    ...(isJoinRequest && caller.approveGroupJoinRequest && joinRaw ? {
      approve: async (flag, remark) => {
        await caller.approveGroupJoinRequest!(
          String(joinRaw.group_id ?? ''),
          String(joinRaw.user_id ?? ''),
          {
            op: 'approve',
            join_request_id: String(joinRaw.join_request_id ?? flag),
            ...(remark ? { reason: remark } : {}),
          },
        );
      },
      reject: async (flag, reason) => {
        await caller.approveGroupJoinRequest!(
          String(joinRaw.group_id ?? ''),
          String(joinRaw.user_id ?? ''),
          {
            op: 'reject',
            join_request_id: String(joinRaw.join_request_id ?? flag),
            ...(reason ? { reason } : {}),
          },
        );
      },
    } : {}),
  }).catch((err) => {
    logger.warn(formatCompact({
      op: 'qq_side_event_failed',
      endpoint: endpointKey,
      event: eventName,
      error: err instanceof Error ? err.message : String(err),
    }));
  });
}
