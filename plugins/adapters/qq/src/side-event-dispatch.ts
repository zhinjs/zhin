import { receiveOneBotLikeSideEvent, type OneBotLikeRawEvent } from '@zhin.js/core';
import type { EndpointEventEmitter } from 'zhin.js/adapter';
import { formatCompact, type getAdapterLogger } from '@zhin.js/logger';
import type { ApproveJoinRequestOptions } from 'qq-official-bot';

export interface QqSideEventCaller {
  approveGroupJoinRequest?(
    groupId: string,
    userId: string,
    options: ApproveJoinRequestOptions,
  ): Promise<unknown>;
}

export function bindQqBotSideEvents(
  bot: { on(event: string, listener: (...args: unknown[]) => void): void },
  dispatch: (eventName: string, raw: unknown) => void,
): void {
  // qq-official-bot emits every dotted prefix. Listening at `notice` once avoids
  // dispatching e.g. notice.group.member.increase three times.
  bot.on('notice', (raw) => dispatch(resolveQqSideEventName(raw), raw));
}

function resolveQqSideEventName(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'notice';
  const record = raw as Record<string, unknown>;
  return ['notice', record.notice_type, record.sub_type]
    .filter((part) => part != null && String(part) !== '')
    .map(String)
    .join('.');
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
    if (Number.isFinite(n) && n > 0) return n;
    const date = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(date) ? date : Date.now();
  };
  if (eventName === 'notice.group.join_request') {
    return {
      ...record,
      post_type: 'request',
      request_type: 'group',
      flag: record.join_request_id != null ? String(record.join_request_id) : undefined,
      user_id: asId(record.user_id),
      group_id: asId(record.group_id),
      comment: formatJoinRequestComment(record.verify_info),
      time: asTime(record.time ?? record.timestamp ?? record.apply_at),
    };
  }
  if (eventName.startsWith('notice.')) {
    const memberChange = eventName.match(/^notice\.group(?:\.member)?\.(increase|decrease)$/);
    const memberUserId = asId(record.user_id)
      ?? asId((record.bot as { self_id?: unknown } | undefined)?.self_id);
    return {
      ...record,
      post_type: 'notice',
      notice_type: memberChange ? `group_${memberChange[1]}` : eventName.replace(/^notice\./, ''),
      ...(memberChange && memberUserId != null ? { user_id: memberUserId } : {}),
      time: asTime(record.time ?? record.timestamp),
    };
  }
  return null;
}

function formatJoinRequestComment(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const verify = value as {
    verify_message?: unknown;
    review_qa_list?: Array<{ question?: unknown; answer?: unknown }>;
  };
  if (typeof verify.verify_message === 'string') return verify.verify_message;
  if (!Array.isArray(verify.review_qa_list)) return undefined;
  const lines = verify.review_qa_list.flatMap((item) => {
    const question = typeof item?.question === 'string' ? item.question : '';
    const answer = typeof item?.answer === 'string' ? item.answer : '';
    return question || answer ? [`${question}${question && answer ? ': ' : ''}${answer}`] : [];
  });
  return lines.length > 0 ? lines.join('\n') : undefined;
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
          },
        );
      },
      reject: async (flag, reason) => {
        await caller.approveGroupJoinRequest!(
          String(joinRaw.group_id ?? ''),
          String(joinRaw.user_id ?? ''),
          {
            op: 'decline',
            join_request_id: String(joinRaw.join_request_id ?? flag),
            ...(reason ? { reject_reason: reason } : {}),
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
