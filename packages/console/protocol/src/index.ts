export const SIDE_EVENT_PUSH = {
  NOTICE_RECEIVE: 'notice.receive',
  REQUEST_RECEIVE: 'request.receive',
  MESSAGE_RECEIVE: 'message.receive',
  ENDPOINT_LIFECYCLE: 'endpoint.lifecycle',
  LOGIN_PENDING: 'endpoint.login.pending',
  LOGIN_EXPIRED: 'endpoint.login.expired',
} as const;

export const SIDE_EVENT_RPC = {
  REQUEST_LIST: 'request.list',
  REQUEST_APPROVE: 'request.approve',
  REQUEST_REJECT: 'request.reject',
  REQUEST_CONSUMED: 'request.consumed',
  NOTICE_CONSUMED: 'notice.consumed',
} as const;

export const LOGIN_RPC = {
  LIST: 'login.list',
  SUBMIT: 'login.submit',
  CANCEL: 'login.cancel',
} as const;

export const INBOX_RPC = {
  MESSAGES: 'inbox.messages',
  REQUESTS: 'inbox.requests',
  NOTICES: 'inbox.notices',
} as const;

export const ENDPOINT_RPC = {
  LIST: 'endpoint.list',
  INFO: 'endpoint.info',
  TEST: 'endpoint.test',
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

/** Browser event dispatched when the bounded history cursor cannot be resumed. */
export const CONSOLE_EVENT_RECOVERY_GAP_EVENT = 'zhin-console-event-recovery-gap' as const;

export interface ConsoleEndpointEventData {
  readonly adapter: string;
  readonly endpointKey: string;
}

export interface ConsoleEventActor {
  readonly id: string;
  readonly name?: string;
}

export interface ConsoleEventParent {
  readonly id: string;
  readonly type: 'group' | 'guild';
  readonly name?: string;
}

export interface ConsoleEventChannel {
  readonly id: string;
  readonly type: string;
  readonly name?: string;
  readonly parent?: ConsoleEventParent;
}

export interface ConsoleRequestEventData extends ConsoleEndpointEventData {
  readonly id: number;
  readonly platformRequestId: string;
  readonly type: string;
  readonly sender: ConsoleEventActor;
  readonly comment: string;
  readonly channel: ConsoleEventChannel;
  readonly timestamp: number;
  readonly canAct?: boolean;
}

export interface ConsoleNoticeEventData extends ConsoleEndpointEventData {
  readonly id: number;
  readonly noticeType: string;
  readonly channel: ConsoleEventChannel;
  readonly payload: string;
  readonly timestamp: number;
}

export interface ConsoleMessageEventData extends ConsoleEndpointEventData {
  readonly direction: 'inbound' | 'outbound';
  readonly channelType: string;
  readonly channelId: string;
  readonly content: unknown;
  readonly timestamp: number;
  readonly messageId?: string;
  readonly sender?: unknown;
  readonly requester?: unknown;
}

export interface ConsoleEventPayloadMap {
  readonly 'notice.receive': ConsoleNoticeEventData;
  readonly 'request.receive': ConsoleRequestEventData;
  readonly 'message.receive': ConsoleMessageEventData;
  readonly 'endpoint.lifecycle': ConsoleEndpointEventData;
  readonly 'endpoint.login.pending': ConsoleEndpointEventData;
  readonly 'endpoint.login.expired': ConsoleEndpointEventData;
  readonly sync: Readonly<{ key: string; value: unknown }>;
  readonly 'init-data': Readonly<{ timestamp: number }>;
  readonly 'config:updated': Readonly<{ pluginName: string | null; keys?: readonly string[] }>;
  readonly 'workrooms:updated': Readonly<{ revision: string }>;
  readonly 'hmr:reload': Readonly<Record<string, unknown>>;
  readonly 'system:restarting': Readonly<Record<string, unknown>>;
}

export type KnownConsoleEventType = keyof ConsoleEventPayloadMap;
export type ConsoleEventDelivery = 'live' | 'history';
export type ConsoleEventData<Type extends string> =
  Type extends KnownConsoleEventType ? ConsoleEventPayloadMap[Type] : unknown;

/** Canonical event shared by SSE delivery, HTTP history and client listeners. */
export interface ConsoleEventEnvelope<
  Type extends string = string,
  Data = ConsoleEventData<Type>,
> {
  readonly runtimeId: string;
  readonly eventId: number;
  readonly type: Type;
  readonly data: Data;
  readonly timestamp: number;
  /** Client-side delivery metadata; absent on Host history records. */
  readonly delivery?: ConsoleEventDelivery;
}

/** Discriminated union for reducers that consume every built-in event type. */
export type KnownConsoleEventEnvelope = {
  [Type in KnownConsoleEventType]: ConsoleEventEnvelope<Type, ConsoleEventPayloadMap[Type]>
}[KnownConsoleEventType];

export interface ConsoleEventHistoryQuery {
  readonly runtimeId?: string;
  readonly after?: number;
  readonly limit?: number;
}

export interface ConsoleEventHistoryPage {
  readonly runtimeId: string;
  readonly items: readonly ConsoleEventEnvelope[];
  readonly oldestAvailableEventId: number | null;
  readonly latestEventId: number;
  readonly nextAfter: number;
  readonly hasMore: boolean;
  /** True when the requested runtime/cursor can no longer be resumed exactly. */
  readonly gap: boolean;
}

export interface ConsoleInboxNoticesQuery {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly limit?: number;
  readonly offset?: number;
  /** Return only durable rows that have not been marked consumed. */
  readonly unreadOnly?: boolean;
}

export interface ConsoleInboxNoticeRow {
  readonly id: number;
  readonly platformNoticeId: string;
  readonly noticeType: string;
  readonly subType?: string;
  readonly channel: ConsoleEventChannel;
  readonly operator?: ConsoleEventActor;
  readonly target?: ConsoleEventActor;
  readonly payload: string;
  readonly timestamp: number;
  readonly consumed: boolean;
  readonly consumedAt?: number;
}

export interface ConsoleInboxRequestRow {
  readonly id: number;
  readonly platformRequestId: string;
  readonly type: string;
  readonly subType?: string;
  readonly actor: ConsoleEventActor;
  readonly comment?: string;
  readonly channel: ConsoleEventChannel;
  readonly timestamp: number;
  readonly resolved: boolean;
  readonly resolvedAt?: number;
  readonly adapter?: string;
  readonly endpointKey?: string;
}

export interface ConsoleInboxMessageRow {
  readonly id: number;
  readonly platformMessageId: string;
  readonly sender: ConsoleEventActor;
  readonly content: unknown;
  readonly raw: unknown;
  readonly timestamp: number;
  readonly channel: ConsoleEventChannel;
  readonly adapter?: string;
  readonly endpointKey?: string;
}

export interface ConsoleInboxNoticesResult {
  readonly notices: readonly ConsoleInboxNoticeRow[];
  readonly inboxEnabled: boolean;
}

export interface ParsedConsoleSseFrame {
  readonly eventId?: number;
  readonly runtimeId?: string;
  readonly timestamp?: number;
  readonly type: string;
  readonly data: unknown;
}

/** Parse one complete SSE frame while preserving the standard `event:` field. */
export function parseConsoleSseFrame(frame: string): ParsedConsoleSseFrame | null {
  let type = '';
  let rawId = '';
  let runtimeId = '';
  let rawTimestamp = '';
  const dataLines: string[] = [];
  for (const rawLine of frame.split(/\r?\n/u)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const separator = rawLine.indexOf(':');
    const field = separator < 0 ? rawLine : rawLine.slice(0, separator);
    let value = separator < 0 ? '' : rawLine.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') type = value;
    else if (field === 'id') rawId = value;
    else if (field === 'runtime') runtimeId = value;
    else if (field === 'timestamp') rawTimestamp = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n')) as unknown;
  } catch {
    return null;
  }
  const parsedId = Number(rawId);
  const eventId = rawId && Number.isSafeInteger(parsedId) && parsedId > 0
    ? parsedId
    : undefined;
  const parsedTimestamp = Number(rawTimestamp);
  const timestamp = rawTimestamp && Number.isSafeInteger(parsedTimestamp) && parsedTimestamp > 0
    ? parsedTimestamp
    : undefined;
  const embeddedType = isRecord(data) && typeof data.type === 'string' ? data.type : '';
  return Object.freeze({
    ...(eventId === undefined ? {} : { eventId }),
    ...(runtimeId ? { runtimeId } : {}),
    ...(timestamp === undefined ? {} : { timestamp }),
    type: type || embeddedType || 'message',
    data,
  });
}

/** Stable capability ids advertised by `endpoint.list` / `endpoint.info`. */
export const ENDPOINT_MANAGEMENT_CAPABILITIES = [
  'listFriends',
  'listGroups',
  'listChannels',
  'listGroupMembers',
  'listRequests',
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

export type ConsoleEndpointOperation = 'recall' | 'edit' | 'reaction' | 'typing';

/** Endpoint row shared by the Host and Remote Console. */
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
  readonly operations?: readonly ConsoleEndpointOperation[];
  readonly managementCapabilities?: readonly EndpointManagementCapability[];
}

export const SIDE_EVENT_NAMES = {
  ...SIDE_EVENT_PUSH,
  ...SIDE_EVENT_RPC,
  ...INBOX_RPC,
  ...ENDPOINT_RPC,
  ...LOGIN_RPC,
} as const;

export type ConsoleInboxEventKind = 'message' | 'request' | 'notice';

export interface ConsoleInboxEvent {
  readonly type: string;
  readonly kind: ConsoleInboxEventKind;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Validate and classify a persistence-worthy canonical push. */
export function parseConsoleInboxEvent(
  input: { readonly type?: unknown; readonly data?: unknown },
): ConsoleInboxEvent | null {
  const type = String(input.type ?? '');
  if (!isRecord(input.data)) return null;
  const kind = inboxKindForPushType(type);
  if (!kind) return null;
  const adapter = nonEmptyString(input.data.adapter);
  const endpointKey = nonEmptyString(input.data.endpointKey);
  if (!adapter || !endpointKey) return null;
  return Object.freeze({
    type,
    kind,
    adapter,
    endpointKey,
    payload: Object.freeze({ ...input.data }),
  });
}

function inboxKindForPushType(type: string): ConsoleInboxEventKind | null {
  if (type === SIDE_EVENT_PUSH.MESSAGE_RECEIVE) return 'message';
  if (type === SIDE_EVENT_PUSH.REQUEST_RECEIVE) return 'request';
  if (type === SIDE_EVENT_PUSH.NOTICE_RECEIVE) return 'notice';
  return null;
}

export interface ConsoleRpcMessage {
  readonly type?: unknown;
  readonly requestId?: unknown;
  readonly data?: unknown;
  readonly [key: string]: unknown;
}

export const CONFIG_RPC = Object.freeze({
  GET: 'config:get',
  GET_ALL: 'config:get-all',
  GET_SOURCE: 'config:get-source',
  REPLACE_SOURCE: 'config:replace-source',
  SET: 'config:set',
} as const);

/** Console plugin management RPC names. Mutations remain full-scope only. */
export const PLUGIN_RPC = Object.freeze({
  PLAN_INSTALL: 'plugin:plan-install',
  INSTALL: 'plugin:install',
  PLAN_UNINSTALL: 'plugin:plan-uninstall',
  UNINSTALL: 'plugin:uninstall',
  PLAN_UPDATE: 'plugin:plan-update',
  UPDATE: 'plugin:update',
  VALIDATE_CONFIG: 'plugin:validate-config',
  DIAGNOSE: 'plugin:diagnose',
  SET_ENABLED: 'plugin:set-enabled',
} as const);

export type ConsoleConfigFormat = 'yaml' | 'json';

export interface ConsoleConfigSource {
  readonly source: string;
  readonly format: ConsoleConfigFormat;
  readonly revision: string;
  readonly configKeys: readonly string[];
}

export const DEMO_RPC_ALLOWLIST: ReadonlySet<string> = new Set([
  'ping',
  'entries:get',
  'pages:list',
  CONFIG_RPC.GET,
  CONFIG_RPC.GET_ALL,
  CONFIG_RPC.GET_SOURCE,
  PLUGIN_RPC.PLAN_INSTALL,
  PLUGIN_RPC.PLAN_UNINSTALL,
  PLUGIN_RPC.PLAN_UPDATE,
  PLUGIN_RPC.VALIDATE_CONFIG,
  PLUGIN_RPC.DIAGNOSE,
  'schema:get',
  'schema:get-all',
  'workrooms:get',
  'schedule:list',
  'cron:list',
  ENDPOINT_RPC.LIST,
  ENDPOINT_RPC.INFO,
  ENDPOINT_RPC.TEST,
  ENDPOINT_RPC.FRIENDS,
  ENDPOINT_RPC.GROUPS,
  ENDPOINT_RPC.CHANNELS,
  ENDPOINT_RPC.GROUP_MEMBERS,
  SIDE_EVENT_RPC.REQUEST_LIST,
  LOGIN_RPC.LIST,
  INBOX_RPC.MESSAGES,
  INBOX_RPC.REQUESTS,
  INBOX_RPC.NOTICES,
]);

export const DEMO_RPC_WRITE_BLOCKLIST: ReadonlySet<string> = new Set([
  CONFIG_RPC.SET,
  CONFIG_RPC.REPLACE_SOURCE,
  PLUGIN_RPC.INSTALL,
  PLUGIN_RPC.UNINSTALL,
  PLUGIN_RPC.UPDATE,
  PLUGIN_RPC.SET_ENABLED,
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
  LOGIN_RPC.SUBMIT,
  LOGIN_RPC.CANCEL,
  ENDPOINT_RPC.SEND_MESSAGE,
  ENDPOINT_RPC.GROUP_KICK,
  ENDPOINT_RPC.GROUP_MUTE,
  ENDPOINT_RPC.GROUP_ADMIN,
  ENDPOINT_RPC.DELETE_FRIEND,
]);

export function isDemoConsoleRpcAllowed(type: unknown): boolean {
  const value = String(type ?? '');
  if (value.startsWith('db:')) return false;
  if (DEMO_RPC_WRITE_BLOCKLIST.has(value)) return false;
  return DEMO_RPC_ALLOWLIST.has(value);
}

export function assertDemoConsoleRpcAllowed(type: unknown): string | null {
  const value = String(type ?? '');
  return isDemoConsoleRpcAllowed(value)
    ? null
    : `Demo scope: RPC "${value}" is forbidden`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  const result = value == null ? '' : String(value).trim();
  return result || null;
}
