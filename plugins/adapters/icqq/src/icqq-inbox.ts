/**
 * icqq IPC request/notice 事件 → 统一收件箱行（unified_inbox_request / unified_inbox_notice）。
 *
 * daemon 经 IpcEvent 推送 icqq client.em 分发的全部事件（见 protocol.ts），
 * 好友/群请求（request.friend.add、request.group.add、request.group.invite）
 * 与通知（notice.friend.*、notice.group.*）随事件流实时到达，无需轮询；
 * endpoint 启动时补一次 GET_SYSTEM_MSG 拉取离线期间积存的待处理请求。
 */
import type { IpcSystemMessage } from './types.js';

/** 行级公共前缀：adapter 槽 localName + endpoint live 名（uin）。 */
export interface IcqqInboxBase {
  readonly adapter: string;
  readonly endpointId: string;
}

/** post_type=request / request.* 判定（OneBot 事件壳）。 */
export function isIcqqRequestPayload(payload: unknown): boolean {
  const postType = (payload as { post_type?: unknown } | null)?.post_type;
  return typeof postType === 'string'
    && (postType === 'request' || postType.startsWith('request.'));
}

/** post_type=notice / notice.* 判定。 */
export function isIcqqNoticePayload(payload: unknown): boolean {
  const postType = (payload as { post_type?: unknown } | null)?.post_type;
  return typeof postType === 'string'
    && (postType === 'notice' || postType.startsWith('notice.'));
}

/**
 * request 事件载荷 → unified_inbox_request 行。
 * platform_request_id 取 flag（审批回执句柄），缺省回退 seq；两者皆无则无法审批，丢弃。
 */
export function buildIcqqInboxRequestRow(
  payload: Record<string, unknown>,
  base: IcqqInboxBase,
): Record<string, unknown> | null {
  const userId = payload.user_id ?? payload.actor_id;
  if (userId == null) return null;
  const flag = asNonEmptyString(payload.flag);
  const platformRequestId = flag ?? (payload.seq != null ? String(payload.seq) : '');
  if (!platformRequestId) return null;
  const requestType = asNonEmptyString(payload.request_type) ?? asNonEmptyString(payload.type);
  const groupId = payload.group_id;
  const isGroup = requestType === 'group' || groupId != null;
  return {
    adapter: base.adapter,
    endpoint_id: base.endpointId,
    platform_request_id: platformRequestId,
    type: isGroup ? 'group' : (requestType ?? 'friend'),
    scene_type: isGroup ? 'group' : null,
    scene_id: String(groupId ?? userId),
    sub_type: asNonEmptyString(payload.sub_type),
    actor_id: String(userId),
    actor_name: asNonEmptyString(payload.nickname),
    comment: asNonEmptyString(payload.comment),
    created_at: toMillis(payload.time),
    resolved: 0,
    resolved_at: null,
    consumed: 0,
    consumed_at: null,
  };
}

/**
 * notice 事件载荷 → unified_inbox_notice 行。
 * 事件本身无稳定 id，platform_notice_id 由 time + actor + type 合成（配合去重）。
 */
export function buildIcqqInboxNoticeRow(
  payload: Record<string, unknown>,
  base: IcqqInboxBase,
): Record<string, unknown> | null {
  const noticeType = asNonEmptyString(payload.notice_type) ?? asNonEmptyString(payload.type);
  if (!noticeType) return null;
  const subType = asNonEmptyString(payload.sub_type);
  const userId = payload.user_id;
  const operatorId = payload.operator_id;
  const groupId = payload.group_id;
  const createdAt = toMillis(payload.time);
  const actorId = operatorId ?? userId;
  const platformNoticeId = asNonEmptyString(payload.notice_id)
    ?? (payload.seq != null ? String(payload.seq) : undefined)
    ?? `${createdAt}_${String(actorId ?? '')}_${noticeType}${subType ? `.${subType}` : ''}`;
  const targetId = userId != null && String(userId) !== String(actorId ?? '') ? userId : undefined;
  return {
    adapter: base.adapter,
    endpoint_id: base.endpointId,
    platform_notice_id: platformNoticeId,
    type: noticeType,
    scene_type: groupId != null ? 'group' : null,
    scene_id: String(groupId ?? userId ?? operatorId ?? ''),
    sub_type: subType,
    actor_id: actorId != null ? String(actorId) : null,
    actor_name: asNonEmptyString(payload.nickname),
    target_id: targetId != null ? String(targetId) : null,
    target_name: null,
    payload: safeJson(payload),
    created_at: createdAt,
    consumed: 0,
    consumed_at: null,
  };
}

/**
 * GET_SYSTEM_MSG 返回项 → unified_inbox_request 行（启动时首次拉取）。
 * friend 列表项 type 语义即好友请求；group 列表项 type 为 add/invite（记 sub_type）。
 */
export function buildIcqqSystemRequestRow(
  message: IpcSystemMessage,
  kind: 'friend' | 'group',
  base: IcqqInboxBase,
): Record<string, unknown> | null {
  if (message.user_id == null) return null;
  const platformRequestId = asNonEmptyString(message.flag)
    ?? (message.seq != null ? String(message.seq) : '');
  if (!platformRequestId) return null;
  return {
    adapter: base.adapter,
    endpoint_id: base.endpointId,
    platform_request_id: platformRequestId,
    type: kind,
    scene_type: kind === 'group' ? 'group' : null,
    scene_id: String(kind === 'group' ? (message.group_id ?? message.user_id) : message.user_id),
    sub_type: kind === 'group' ? (asNonEmptyString(message.type) ?? null) : null,
    actor_id: String(message.user_id),
    actor_name: asNonEmptyString(message.nickname),
    comment: asNonEmptyString(message.comment),
    created_at: toMillis(message.time),
    resolved: 0,
    resolved_at: null,
    consumed: 0,
    consumed_at: null,
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** oicq 事件 time 为秒；缺失时回退当前时间。 */
function toMillis(time: unknown): number {
  const seconds = Number(time);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Date.now();
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return '{}';
  }
}
