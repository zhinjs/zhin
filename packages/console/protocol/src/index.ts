export const SIDE_EVENT_PUSH = {
  NOTICE_RECEIVE: 'notice.receive',
  REQUEST_RECEIVE: 'request.receive',
  MESSAGE_RECEIVE: 'message.receive',
  ENDPOINT_LIFECYCLE: 'endpoint.lifecycle',
} as const;

export const SIDE_EVENT_RPC = {
  REQUEST_LIST: 'request.list',
  REQUEST_APPROVE: 'request.approve',
  REQUEST_REJECT: 'request.reject',
  REQUEST_CONSUMED: 'request.consumed',
  NOTICE_CONSUMED: 'notice.consumed',
} as const;

export const INBOX_RPC = {
  MESSAGES: 'inbox.messages',
  REQUESTS: 'inbox.requests',
  NOTICES: 'inbox.notices',
} as const;

export const ENDPOINT_RPC = {
  LIST: 'endpoint.list',
  INFO: 'endpoint.info',
  SEND_MESSAGE: 'endpoint.send_message',
  FRIENDS: 'endpoint.friends',
  GROUPS: 'endpoint.groups',
  CHANNELS: 'endpoint.channels',
  DELETE_FRIEND: 'endpoint.delete_friend',
  GROUP_MEMBERS: 'endpoint.group_members',
  GROUP_KICK: 'endpoint.group_kick',
  GROUP_MUTE: 'endpoint.group_mute',
  GROUP_ADMIN: 'endpoint.group_admin',
} as const;

/** Stable capability ids advertised by `endpoint.list` / `endpoint.info`. */
export const ENDPOINT_MANAGEMENT_CAPABILITIES = [
  'listFriends',
  'listGroups',
  'listChannels',
  'listGroupMembers',
  'approveRequest',
  'rejectRequest',
  'kickGroupMember',
  'muteGroupMember',
  'setGroupAdmin',
  'deleteFriend',
] as const;

export type EndpointManagementCapability =
  (typeof ENDPOINT_MANAGEMENT_CAPABILITIES)[number];

export type ConsoleEndpointPhase =
  | 'pending'
  | 'starting'
  | 'online'
  | 'failed'
  | 'unconfigured';

/**
 * Forward-compatible Endpoint row shared by both Host implementations and the
 * Remote Console. Optional fields allow clients to consume older Hosts.
 */
export interface ConsoleEndpointSummary {
  readonly name: string;
  readonly adapter: string;
  readonly connected: boolean;
  readonly status: 'online' | 'offline';
  readonly owner?: string;
  readonly phase?: ConsoleEndpointPhase;
  readonly pendingLogin?: boolean;
  readonly pendingRequestCount?: number;
  readonly pendingNoticeCount?: number;
  readonly managementCapabilities?: readonly EndpointManagementCapability[];
}

export const SIDE_EVENT_NAMES = {
  ...SIDE_EVENT_PUSH,
  ...SIDE_EVENT_RPC,
  ...INBOX_RPC,
  ...ENDPOINT_RPC,
} as const;

const PUSH_TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'endpoint:message': SIDE_EVENT_PUSH.MESSAGE_RECEIVE,
  'endpoint:request': SIDE_EVENT_PUSH.REQUEST_RECEIVE,
  'endpoint:notice': SIDE_EVENT_PUSH.NOTICE_RECEIVE,
  'endpoint:lifecycle': SIDE_EVENT_PUSH.ENDPOINT_LIFECYCLE,
});

export function normalizeConsolePushType(type: unknown): string {
  const value = String(type ?? '');
  return PUSH_TYPE_ALIASES[value] ?? value;
}

export function normalizeConsolePushMessage<T extends { readonly type?: unknown }>(
  message: T,
): Readonly<T & { type: string }> {
  const candidate = message as { readonly data?: unknown };
  const data = isRecord(candidate.data)
    ? normalizeConsolePushData(candidate.data)
    : candidate.data;
  return Object.freeze({
    ...message,
    type: normalizeConsolePushType(message.type),
    ...(data === undefined ? {} : { data }),
  });
}

export type ConsoleInboxEventKind = 'message' | 'request' | 'notice';

export interface ConsoleInboxEvent {
  readonly type: string;
  readonly kind: ConsoleInboxEventKind;
  readonly adapter: string;
  readonly endpointId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Normalize and classify a persistence-worthy push at the transport seam.
 * Callers never need to understand legacy event names or identity aliases.
 */
export function parseConsoleInboxEvent(
  input: { readonly type?: unknown; readonly data?: unknown },
): ConsoleInboxEvent | null {
  const message = normalizeConsolePushMessage(input);
  if (!isRecord(message.data)) return null;
  const kind = inboxKindForPushType(message.type);
  if (!kind) return null;
  const adapter = nonEmptyString(message.data.adapter);
  const endpointId = nonEmptyString(message.data.endpointId);
  if (!adapter || !endpointId) return null;
  return Object.freeze({
    type: message.type,
    kind,
    adapter,
    endpointId,
    payload: message.data,
  });
}

function inboxKindForPushType(type: string): ConsoleInboxEventKind | null {
  if (type === SIDE_EVENT_PUSH.MESSAGE_RECEIVE) return 'message';
  if (type === SIDE_EVENT_PUSH.REQUEST_RECEIVE) return 'request';
  if (type === SIDE_EVENT_PUSH.NOTICE_RECEIVE) return 'notice';
  return null;
}

function normalizeConsolePushData(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const data = { ...input };
  aliasField(data, 'adapter', input.adapter, input.$adapter);
  aliasField(
    data,
    'endpointId',
    input.endpointId,
    input.endpoint_id,
    input.endpoint,
    input.$endpoint,
    input.bot,
  );
  aliasField(data, 'channelId', input.channelId, input.channel_id, input.$channel_id);
  aliasField(data, 'channelType', input.channelType, input.channel_type, input.$channel_type);
  return Object.freeze(data);
}

const RPC_TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  'endpoint:list': ENDPOINT_RPC.LIST,
  'endpoint:info': ENDPOINT_RPC.INFO,
  'endpoint:sendMessage': ENDPOINT_RPC.SEND_MESSAGE,
  'endpoint:friends': ENDPOINT_RPC.FRIENDS,
  'endpoint:groups': ENDPOINT_RPC.GROUPS,
  'endpoint:channels': ENDPOINT_RPC.CHANNELS,
  'endpoint:deleteFriend': ENDPOINT_RPC.DELETE_FRIEND,
  'endpoint:groupMembers': ENDPOINT_RPC.GROUP_MEMBERS,
  'endpoint:groupKick': ENDPOINT_RPC.GROUP_KICK,
  'endpoint:groupMute': ENDPOINT_RPC.GROUP_MUTE,
  'endpoint:groupAdmin': ENDPOINT_RPC.GROUP_ADMIN,
  'endpoint:requests': SIDE_EVENT_RPC.REQUEST_LIST,
  'endpoint:requestApprove': SIDE_EVENT_RPC.REQUEST_APPROVE,
  'endpoint:requestReject': SIDE_EVENT_RPC.REQUEST_REJECT,
  'endpoint:requestConsumed': SIDE_EVENT_RPC.REQUEST_CONSUMED,
  'endpoint:noticeConsumed': SIDE_EVENT_RPC.NOTICE_CONSUMED,
  'endpoint:inboxMessages': INBOX_RPC.MESSAGES,
  'endpoint:inboxRequests': INBOX_RPC.REQUESTS,
  'endpoint:inboxNotices': INBOX_RPC.NOTICES,
});

export interface ConsoleRpcMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly data?: unknown;
  readonly [key: string]: unknown;
}

export function normalizeConsoleRpcType(type: unknown): string {
  const value = String(type ?? '');
  return RPC_TYPE_ALIASES[value] ?? value;
}

/**
 * Canonicalize one Console request before authorization or dispatch.
 * Nested `data` wins over top-level compatibility fields.
 */
export function normalizeConsoleRpcMessage(
  input: ConsoleRpcMessage,
): Readonly<Record<string, unknown> & { type: string }> {
  const data = isRecord(input.data) ? input.data : {};
  const merged: Record<string, unknown> = { ...input, ...data };
  const payloadType = data.type;
  aliasField(merged, '$adapter', data.$adapter, data.adapter, input.$adapter, input.adapter);
  aliasField(merged, '$endpoint', data.$endpoint, data.endpointId, data.endpoint,
    input.$endpoint, input.endpointId, input.endpoint);
  aliasField(merged, '$id', data.$id, data.id, input.$id, input.id);
  aliasField(merged, '$type', data.$type, payloadType, input.$type);
  aliasField(merged, '$channel_id', data.$channel_id, data.channelId, data.channel_id, data.id,
    input.$channel_id, input.channelId, input.channel_id, input.id);
  aliasField(merged, '$channel_type', data.$channel_type, data.channelType, data.channel_type,
    payloadType, input.$channel_type, input.channelType, input.channel_type);
  aliasField(merged, '$content', data.$content, data.content, input.$content, input.content);
  aliasField(merged, '$parent', data.$parent, data.parent, input.$parent, input.parent);
  aliasField(merged, '$group_id', data.$group_id, data.groupId, data.group_id,
    input.$group_id, input.groupId, input.group_id);
  aliasField(merged, '$user_id', data.$user_id, data.userId, data.user_id,
    input.$user_id, input.userId, input.user_id);
  aliasField(merged, '$duration', data.$duration, data.duration, input.$duration, input.duration);
  aliasField(merged, '$enable', data.$enable, data.enable, input.$enable, input.enable);
  aliasField(merged, '$remark', data.$remark, data.remark, input.$remark, input.remark);
  aliasField(merged, '$reason', data.$reason, data.reason, input.$reason, input.reason);
  merged.type = normalizeConsoleRpcType(input.type);
  return Object.freeze(merged as Record<string, unknown> & { type: string });
}

export const DEMO_RPC_ALLOWLIST: ReadonlySet<string> = new Set([
  'ping',
  'entries:get',
  'pages:list',
  'config:get',
  'config:get-all',
  'config:get-yaml',
  'schema:get',
  'schema:get-all',
  'schedule:list',
  'cron:list',
  ENDPOINT_RPC.LIST,
  ENDPOINT_RPC.INFO,
  ENDPOINT_RPC.SEND_MESSAGE,
  ENDPOINT_RPC.FRIENDS,
  ENDPOINT_RPC.GROUPS,
  ENDPOINT_RPC.CHANNELS,
  ENDPOINT_RPC.GROUP_MEMBERS,
  SIDE_EVENT_RPC.REQUEST_LIST,
  INBOX_RPC.MESSAGES,
  INBOX_RPC.REQUESTS,
  INBOX_RPC.NOTICES,
]);

export const DEMO_RPC_WRITE_BLOCKLIST: ReadonlySet<string> = new Set([
  'config:set',
  'config:save-yaml',
  'files:save',
  'env:save',
  'db:insert',
  'db:update',
  'db:delete',
  'db:drop-table',
  'db:kv:set',
  'db:kv:delete',
  'system:restart',
  'schedule:add',
  'schedule:remove',
  'schedule:pause',
  'schedule:resume',
  'cron:add',
  'cron:remove',
  'cron:pause',
  'cron:resume',
  SIDE_EVENT_RPC.REQUEST_APPROVE,
  SIDE_EVENT_RPC.REQUEST_REJECT,
  SIDE_EVENT_RPC.REQUEST_CONSUMED,
  SIDE_EVENT_RPC.NOTICE_CONSUMED,
  ENDPOINT_RPC.GROUP_KICK,
  ENDPOINT_RPC.GROUP_MUTE,
  ENDPOINT_RPC.GROUP_ADMIN,
  ENDPOINT_RPC.DELETE_FRIEND,
]);

export function isDemoConsoleRpcAllowed(type: unknown): boolean {
  const canonical = normalizeConsoleRpcType(type);
  if (canonical.startsWith('db:')) return false;
  if (DEMO_RPC_WRITE_BLOCKLIST.has(canonical)) return false;
  return DEMO_RPC_ALLOWLIST.has(canonical);
}

export function assertDemoConsoleRpcAllowed(type: unknown): string | null {
  const canonical = normalizeConsoleRpcType(type);
  return isDemoConsoleRpcAllowed(canonical)
    ? null
    : `Demo scope: RPC "${canonical}" is forbidden`;
}

/** Stable response payload shared by legacy and Plugin Runtime Hosts. */
export function endpointSendResult(messageId: unknown): Readonly<{
  message_id: string;
  messageId: string;
}> {
  const value = messageId == null ? '' : String(messageId);
  return Object.freeze({ message_id: value, messageId: value });
}

function aliasField(target: Record<string, unknown>, key: string, ...values: unknown[]): void {
  const value = values.find((candidate) => candidate !== undefined);
  if (value !== undefined) target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  const result = value == null ? '' : String(value).trim();
  return result || null;
}
