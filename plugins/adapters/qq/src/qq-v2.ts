/**
 * QQ 官方 Bot API v2 中已核对过的请求。
 *
 * 字段只取自官方文档，不补文档里没有的键：
 * - 图文卡片：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html
 *   单聊同一结构：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_messages.post.html
 * - @全体成员：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/text-chain.html
 * - 入群申请：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_join_request_list.get.html
 *   https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_approval_join_request_member_openid.post.html
 * - 群黑名单：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.get.html
 *   https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_member_blacklist.post.html
 *
 * 两个 GET 的分页字段写在「请求体」标题下，示例却是不带 body 的 GET。
 * 未传 cursor/limit 时请求与示例一致；调用方传入时放到 query，不发明 JSON body。
 */
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type {
  EndpointGroupBlacklistChangeResult,
  EndpointGroupBlacklistPage,
  EndpointGroupBlacklistUser,
  EndpointGroupJoinQuestion,
  EndpointGroupJoinRequest,
  EndpointGroupJoinRequestPage,
} from 'zhin.js/adapter';

/** 文本与 Markdown 里 @全体成员的嵌入标记。旧的 `@everyone` 官方已标为即将弃用。 */
export const QQ_AT_EVERYONE = '<qqbot-at-everyone />';

/** 入群申请列表单页上限（默认 20）。 */
export const QQ_JOIN_REQUEST_PAGE_MAX = 50;
/** 群黑名单查询单页上限（默认 20）。 */
export const QQ_BLACKLIST_PAGE_MAX = 100;
/** 群黑名单增删单次人数上限。 */
export const QQ_BLACKLIST_BATCH_MAX = 20;

const TUWEN_TITLE_MAX = 50;
const TUWEN_DESCRIPTION_MAX = 200;
const TUWEN_URL_MAX = 1024;

export interface QqTuwenContent {
  readonly title: string;
  readonly description: string;
  readonly url: string;
  readonly pic_url: string;
}

export interface QqHttpCaller {
  get(url: string, config?: { readonly params?: Readonly<Record<string, string | number>> }): Promise<{ data: unknown }>;
  post(url: string, body?: unknown): Promise<{ data: unknown }>;
}

export interface QqV2Request {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: Readonly<Record<string, unknown>>;
}

export function qqHttpOf(api: { readonly request?: QqHttpCaller } | undefined): QqHttpCaller {
  const request = api?.request;
  if (!request || typeof request.get !== 'function' || typeof request.post !== 'function') {
    throw new Error('QQ HTTP API is unavailable on this transport');
  }
  return request;
}

export async function callQqHttp(http: QqHttpCaller, request: QqV2Request): Promise<unknown> {
  if (request.method === 'GET') {
    const { data } = await http.get(request.path, request.query ? { params: request.query } : undefined);
    return data;
  }
  const { data } = await http.post(request.path, request.body ?? {});
  return data;
}

/** 官方 openid 不含空白和 `/?#`；不符合的值直接拒绝。路径上再做百分号编码。 */
export function qqId(value: string, what: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || /[\s/?#]/.test(id)) throw new Error(`Invalid QQ ${what}`);
  return id;
}

export function qqPathId(value: string, what: string): string {
  return encodeURIComponent(qqId(value, what));
}

export function qqAtUserMarkup(id: string): string {
  if (!id || /["<>&\s]/.test(id)) {
    throw new EndpointDeliveryError('unsupported_operation', 'QQ @用户的 id 含有标记里不能出现的字符', 'not_sent');
  }
  return `<qqbot-at-user id="${id}" />`;
}

function chars(value: string): number {
  return [...value].length;
}

function cardError(message: string): EndpointDeliveryError {
  return new EndpointDeliveryError('unsupported_operation', message, 'not_sent');
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw cardError(`QQ 图文卡片 ${field} 必须是字符串`);
  const length = chars(value);
  if (length < 1 || length > max) throw cardError(`QQ 图文卡片 ${field} 长度必须是 1..${max} 个字符`);
  return value;
}

function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.startsWith('https://') || value.length > TUWEN_URL_MAX || /\s/.test(value)) {
    throw cardError(`QQ 图文卡片 ${field} 必须是长度不超过 ${TUWEN_URL_MAX} 的 https 链接`);
  }
  return value;
}

/** 官方 MessageCard：`type=tuwen`，content 四字段全部必填。 */
export function parseQqTuwenContent(data: Record<string, unknown> | undefined): QqTuwenContent {
  if (data?.type !== undefined && data.type !== 'tuwen') throw cardError('QQ 图文卡片只支持 type=tuwen');
  const content = data?.content;
  if (!content || typeof content !== 'object' || Array.isArray(content)) throw cardError('QQ 图文卡片缺少 content');
  const fields = content as Record<string, unknown>;
  return {
    title: boundedText(fields.title, 'title', TUWEN_TITLE_MAX),
    description: boundedText(fields.description, 'description', TUWEN_DESCRIPTION_MAX),
    url: httpsUrl(fields.url, 'url'),
    pic_url: httpsUrl(fields.pic_url, 'pic_url'),
  };
}

export function qqCardSendRequest(input: {
  readonly kind: 'private' | 'group';
  readonly targetId: string;
  readonly content: QqTuwenContent;
  readonly msgId?: string;
  readonly eventId?: string;
  readonly msgSeq?: number;
  readonly referenceMessageId?: string;
}): QqV2Request {
  const target = qqPathId(input.targetId, input.kind === 'group' ? 'group id' : 'user id');
  const body: Record<string, unknown> = {
    msg_type: 8,
    card: { type: 'tuwen', content: input.content },
  };
  if (input.msgId) body.msg_id = input.msgId;
  if (input.eventId) body.event_id = input.eventId;
  if (input.msgSeq !== undefined) body.msg_seq = input.msgSeq;
  if (input.referenceMessageId) body.message_reference = { message_id: input.referenceMessageId };
  return {
    method: 'POST',
    path: input.kind === 'group' ? `/v2/groups/${target}/messages` : `/v2/users/${target}/messages`,
    body,
  };
}

export function qqPageQuery(cursor: string | undefined, limit: number | undefined, max: number): Readonly<Record<string, string | number>> | undefined {
  const query: Record<string, string | number> = {};
  if (cursor !== undefined) {
    if (typeof cursor !== 'string') throw new TypeError('QQ page cursor must be a string');
    query.cursor = cursor;
  }
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > max) throw new RangeError(`QQ page limit must be 1..${max}`);
    query.limit = limit;
  }
  return Object.keys(query).length > 0 ? query : undefined;
}

export function qqJoinRequestListRequest(groupId: string, cursor?: string, limit?: number): QqV2Request {
  return {
    method: 'GET',
    path: `/v2/groups/${qqPathId(groupId, 'group id')}/join_request_list`,
    query: qqPageQuery(cursor, limit, QQ_JOIN_REQUEST_PAGE_MAX),
  };
}

export function qqJoinApprovalRequest(input: {
  readonly groupId: string;
  readonly memberId: string;
  readonly op: 'approve' | 'decline';
  readonly joinRequestId?: string;
  readonly rejectReason?: string;
  readonly addToBlacklist?: boolean;
}): QqV2Request {
  if (input.op === 'approve' && (input.rejectReason !== undefined || input.addToBlacklist === true)) {
    throw new Error('QQ join approval cannot include a reject reason or blacklist flag');
  }
  const body: Record<string, unknown> = { op: input.op };
  if (input.joinRequestId !== undefined) {
    const id = input.joinRequestId.trim();
    if (!id) throw new Error('Invalid QQ join request id');
    body.join_request_id = id;
  }
  if (input.op === 'decline' && input.rejectReason) body.reject_reason = input.rejectReason;
  if (input.op === 'decline' && input.addToBlacklist === true) body.add_to_member_blacklist = true;
  return {
    method: 'POST',
    path: `/v2/groups/${qqPathId(input.groupId, 'group id')}/approval_join_request/${qqPathId(input.memberId, 'member id')}`,
    body,
  };
}

export function qqBlacklistListRequest(groupId: string, cursor?: string, limit?: number): QqV2Request {
  return {
    method: 'GET',
    path: `/v2/groups/${qqPathId(groupId, 'group id')}/member_blacklist`,
    query: qqPageQuery(cursor, limit, QQ_BLACKLIST_PAGE_MAX),
  };
}

export function qqBlacklistChangeRequest(groupId: string, op: 'add' | 'del', userIds: readonly string[]): QqV2Request {
  if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > QQ_BLACKLIST_BATCH_MAX) {
    throw new RangeError(`QQ blacklist change accepts 1..${QQ_BLACKLIST_BATCH_MAX} member ids`);
  }
  return {
    method: 'POST',
    path: `/v2/groups/${qqPathId(groupId, 'group id')}/member_blacklist`,
    body: { op, member_openids: userIds.map(id => qqId(id, 'member id')) },
  };
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`QQ ${what} response is missing`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`QQ response is missing ${field}`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function nextCursor(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new Error('QQ response next_cursor is not a string');
  return value;
}

function questions(value: unknown): readonly EndpointGroupJoinQuestion[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('QQ join request review_qa_list is not an array');
  return value.map(item => {
    const row = record(item, 'review question');
    return { question: requiredString(row.question, 'question'), answer: requiredString(row.answer, 'answer') };
  });
}

export function readQqJoinRequestPage(data: unknown): EndpointGroupJoinRequestPage {
  const body = record(data, 'join request list');
  if (!Array.isArray(body.list)) throw new Error('QQ join request response is missing list');
  const requests = body.list.map((item): EndpointGroupJoinRequest => {
    const row = record(item, 'join request');
    const verify = row.verify_info === undefined ? undefined : record(row.verify_info, 'verify_info');
    const asked = verify ? questions(verify.review_qa_list) : undefined;
    return {
      joinRequestId: requiredString(row.join_request_id, 'join_request_id'),
      memberId: requiredString(row.member_openid, 'member_openid'),
      ...(optionalString(row.username) ? { username: optionalString(row.username) } : {}),
      ...(optionalString(row.apply_at) ? { appliedAt: optionalString(row.apply_at) } : {}),
      ...(optionalString(row.apply_source) ? { source: optionalString(row.apply_source) } : {}),
      ...(optionalString(row.invited_by) ? { invitedBy: optionalString(row.invited_by) } : {}),
      ...(typeof row.bot === 'boolean' ? { bot: row.bot } : {}),
      ...(verify && optionalString(verify.verify_message) ? { verifyMessage: optionalString(verify.verify_message) } : {}),
      ...(optionalString(row.risk_tips) ? { riskTips: optionalString(row.risk_tips) } : {}),
      ...(asked && asked.length > 0 ? { questions: asked } : {}),
    };
  });
  return { requests, nextCursor: nextCursor(body.next_cursor) };
}

export function readQqBlacklistPage(data: unknown): EndpointGroupBlacklistPage {
  const body = record(data, 'blacklist');
  if (!Array.isArray(body.users)) throw new Error('QQ blacklist response is missing users');
  const users = body.users.map((item): EndpointGroupBlacklistUser => {
    const row = record(item, 'blacklist user');
    return {
      userId: requiredString(row.member_openid, 'member_openid'),
      ...(optionalString(row.username) ? { username: optionalString(row.username) } : {}),
      ...(optionalString(row.banned_at) ? { bannedAt: optionalString(row.banned_at) } : {}),
      ...(typeof row.bot === 'boolean' ? { bot: row.bot } : {}),
      ...(optionalString(row.union_openid) ? { unionId: optionalString(row.union_openid) } : {}),
    };
  });
  return { users, nextCursor: nextCursor(body.next_cursor) };
}

export function readQqBlacklistChange(data: unknown): EndpointGroupBlacklistChangeResult {
  const body = record(data, 'blacklist change');
  if (!Array.isArray(body.fail_openids) || body.fail_openids.some(id => typeof id !== 'string')) {
    throw new Error('QQ blacklist response is missing fail_openids');
  }
  return { failedUserIds: body.fail_openids };
}
