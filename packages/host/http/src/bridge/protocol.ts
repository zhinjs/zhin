/**
 * Gateway ↔ instance control channel protocol (ADR 0054 §3).
 *
 * The channel is the Node child-process IPC channel opened by the gateway with
 * `serialization: 'advanced'` (structured clone: `Uint8Array` travels as is). Every message is
 * `{ type, id?, payload }`. Both sides import this module so the message shapes, limits and the
 * protocol version stay in one place.
 *
 * Streams
 * - HTTP exchanges and WebSocket connections are identified by a gateway-assigned `id`.
 * - Bodies travel in chunks of at most {@link BridgeLimits.maxChunkBytes}. Flow control is
 *   credit based: each direction of a stream starts with {@link BridgeLimits.initialCreditBytes}
 *   of credit; the receiver grants more (`http.request.credit` / `http.response.credit`) as its
 *   consumer reads. A sender never has more than the window in flight, so memory per stream is
 *   bounded on both ends. A receiver that gets more than it granted fails the stream.
 * - WebSocket frames are whole messages (at most {@link BridgeLimits.maxWsMessageBytes}); the
 *   receiver acknowledges delivered bytes with `ws.drain`, which drives `bufferedAmount`.
 * - Either side cancels: `http.request.abort` (gateway: client went away / timeout),
 *   `http.response.error` (instance: handler or body failed), `ws.close` (both).
 *
 * This module must not import `node:http` / `ws`: the instance loads it.
 */
import type { ConsolePluginPermissionInfo } from '@zhin.js/console-protocol';
import type { ConsoleAuditEntry, ConsolePrincipal } from '../access-control.js';
import type { HttpHostAddress } from '../host-options.js';
import type { RouteMeta } from '../openapi.js';

/**
 * Bumped on any incompatible change to the control channel messages.
 * - 1: `ready` / `restart-request` / `shutdown` (B1.1).
 * - 2: route table, HTTP streams, WebSocket frames, forwarded principal (B1.2); interim delegated
 *   credential resolution (`auth.*`).
 * - 3: Console accounts live in the gateway (B1.4): `auth.*` removed; `catalog` (plugin permission
 *   catalog) and `audit` (instance-side audit entries) from the instance; `principal-revoked`
 *   from the gateway.
 */
export const INSTANCE_BRIDGE_PROTOCOL_VERSION = 3;

/** Protocol versions this build can talk to. */
export const SUPPORTED_BRIDGE_PROTOCOL_VERSIONS: readonly number[] = Object.freeze([INSTANCE_BRIDGE_PROTOCOL_VERSION]);

export function isBridgeProtocolCompatible(version: number): boolean {
  return SUPPORTED_BRIDGE_PROTOCOL_VERSIONS.includes(version);
}

/**
 * Set by the gateway on the instance child process; marks the process as a supervised instance.
 * Its value is the gateway's {@link INSTANCE_BRIDGE_PROTOCOL_VERSION}, so the instance can
 * refuse an incompatible gateway before it starts anything.
 */
export const INSTANCE_CHILD_ENV = 'ZHIN_RUNTIME_CHILD';

/**
 * Set by the gateway on the instance child process: the gateway's local control endpoint (socket
 * path — including the `os.tmpdir()` fallback for deep project roots — or named pipe). Whoever
 * connects to it is the local owner (ADR 0054 §6), so the instance keeps the Agent's file and
 * shell tools away from it. Absent when the gateway runs without a local socket.
 */
export const GATEWAY_SOCKET_ENV = 'ZHIN_GATEWAY_SOCKET';

export class BridgeProtocolMismatchError extends Error {
  readonly code = 'ZHIN_BRIDGE_PROTOCOL_MISMATCH';
  constructor(readonly peerVersion: number, readonly side: 'gateway' | 'instance') {
    super(`${side === 'gateway' ? 'Gateway' : 'Instance'} control channel protocol ${peerVersion} is not supported `
      + `(this build speaks ${SUPPORTED_BRIDGE_PROTOCOL_VERSIONS.join(', ')}); upgrade zhin.js and @zhin.js/gateway together`);
    this.name = 'BridgeProtocolMismatchError';
  }
}

/** Per-frame size limits and stream windows. Both ends use the same defaults. */
export interface BridgeLimits {
  /** Largest body chunk in one message. */
  readonly maxChunkBytes: number;
  /** Credit each stream direction starts with (also the most a receiver buffers). */
  readonly initialCreditBytes: number;
  /** Request line + headers (names and values) of one request or response head. */
  readonly maxHeadBytes: number;
  /** Largest WebSocket message (text is measured as UTF-16 length × 3 upper bound). */
  readonly maxWsMessageBytes: number;
  /** Unacknowledged WebSocket bytes a sender queues before closing with 1013. */
  readonly maxWsBufferedBytes: number;
  /** Concurrent HTTP exchanges + WebSocket connections per instance. */
  readonly maxStreams: number;
  /** Entries in a route table. */
  readonly maxRoutes: number;
}

export const DEFAULT_BRIDGE_LIMITS: BridgeLimits = Object.freeze({
  maxChunkBytes: 64 * 1024,
  initialCreditBytes: 256 * 1024,
  maxHeadBytes: 64 * 1024,
  maxWsMessageBytes: 16 * 1024 * 1024,
  maxWsBufferedBytes: 32 * 1024 * 1024,
  maxStreams: 4096,
  maxRoutes: 4096,
});

/** Gateway: time to wait for a response head before failing with `timeout`. */
export const DEFAULT_BRIDGE_RESPONSE_TIMEOUT_MS = 120_000;
/** Gateway: time to wait for `ws.accepted` / `ws.rejected`. */
export const DEFAULT_BRIDGE_WS_OPEN_TIMEOUT_MS = 30_000;

const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 1024;

export interface BridgeMessage<Type extends string, Payload> {
  readonly type: Type;
  readonly id?: string;
  readonly payload: Payload;
}

/** A message that belongs to one stream (`id` is required). */
export interface BridgeStreamMessage<Type extends string, Payload> extends BridgeMessage<Type, Payload> {
  readonly id: string;
}

/** Header list; repeated names (e.g. `set-cookie`) stay separate. */
export type BridgeHeaders = readonly (readonly [string, string])[];

// ---- route table

export interface BridgeHttpRoute {
  readonly method: string;
  /** `/path` or `/prefix/*`. */
  readonly pattern: string;
  readonly meta?: RouteMeta;
}

export interface BridgeWsRoute {
  readonly path: string;
  /** `host`: the gateway authenticates before upgrade; `protocol`: the route authenticates itself. */
  readonly auth: 'host' | 'protocol';
}

/**
 * Routes the instance currently serves. The gateway authenticates `{apiBase}` routes and
 * `auth: 'host'` sockets and forwards the rest unauthenticated (ADR 0054 §3).
 */
export interface BridgeRouteTable {
  /** Increases with every table the instance sends. */
  readonly revision: number;
  /** Committed Runtime generation, when known. */
  readonly generation?: number;
  readonly apiBase: string;
  readonly http: readonly BridgeHttpRoute[];
  readonly ws: readonly BridgeWsRoute[];
}

export const EMPTY_ROUTE_TABLE: BridgeRouteTable = Object.freeze({
  revision: 0,
  apiBase: '/api',
  http: Object.freeze([]),
  ws: Object.freeze([]),
});

// ---- instance → gateway

export interface InstanceReadyPayload {
  /** {@link INSTANCE_BRIDGE_PROTOCOL_VERSION} the instance was built with. */
  readonly version: number;
  /** Committed Runtime generation at the time the instance became ready. */
  readonly generation?: number;
  readonly pid: number;
  /** Route table at ready time (also sent earlier with `routes`). */
  readonly routes?: BridgeRouteTable;
}

export interface InstanceRestartRequestPayload {
  /** Short machine-readable reason, e.g. `console`, `dependencies`, `self-change`. */
  readonly reason: string;
}

export interface HttpResponseHeadPayload {
  readonly status: number;
  readonly statusText?: string;
  readonly headers: BridgeHeaders;
  /** False for a bodiless response: no `http.response.body` follows, `http.response.end` does. */
  readonly body: boolean;
}

export interface BodyChunkPayload { readonly chunk: Uint8Array }
export interface CreditPayload { readonly bytes: number }
export interface StreamErrorPayload { readonly message: string }
export interface WsRejectedPayload { readonly status: 401 | 403 | 404 | 503 }
export interface WsMessagePayload { readonly data: string | Uint8Array }
export interface WsClosePayload { readonly code: number; readonly reason: string }

export type InstanceReadyMessage = BridgeMessage<'ready', InstanceReadyPayload>;
export type InstanceRestartRequestMessage = BridgeMessage<'restart-request', InstanceRestartRequestPayload>;
export type InstanceRoutesMessage = BridgeMessage<'routes', { readonly table: BridgeRouteTable }>;
export type HttpResponseHeadMessage = BridgeStreamMessage<'http.response.head', HttpResponseHeadPayload>;
export type HttpResponseBodyMessage = BridgeStreamMessage<'http.response.body', BodyChunkPayload>;
export type HttpResponseEndMessage = BridgeStreamMessage<'http.response.end', Record<string, never>>;
export type HttpResponseErrorMessage = BridgeStreamMessage<'http.response.error', StreamErrorPayload>;
export type HttpRequestCreditMessage = BridgeStreamMessage<'http.request.credit', CreditPayload>;
export type WsAcceptedMessage = BridgeStreamMessage<'ws.accepted', Record<string, never>>;
export type WsRejectedMessage = BridgeStreamMessage<'ws.rejected', WsRejectedPayload>;
export type WsMessageMessage = BridgeStreamMessage<'ws.message', WsMessagePayload>;
export type WsCloseMessage = BridgeStreamMessage<'ws.close', WsClosePayload>;
export type WsDrainMessage = BridgeStreamMessage<'ws.drain', CreditPayload>;

/**
 * Plugin permission catalog of the instance's current generation (ADR 0049 amendment): the
 * gateway uses it for level grants in `/auth/me`, `iam.roles.list` and its own authorization.
 * Sent on listen and whenever it changes (generation commit).
 */
export interface InstanceCatalogPayload {
  readonly pluginPermissions: readonly ConsolePluginPermissionInfo[];
}

/** An audit entry written by the instance (its RPC dispatcher); the gateway owns the audit log. */
export interface InstanceAuditPayload {
  readonly entry: ConsoleAuditEntry;
}

export type InstanceCatalogMessage = BridgeMessage<'catalog', InstanceCatalogPayload>;
export type InstanceAuditMessage = BridgeMessage<'audit', InstanceAuditPayload>;

export type InstanceToGatewayMessage =
  | InstanceReadyMessage
  | InstanceCatalogMessage
  | InstanceAuditMessage
  | InstanceRestartRequestMessage
  | InstanceRoutesMessage
  | HttpResponseHeadMessage
  | HttpResponseBodyMessage
  | HttpResponseEndMessage
  | HttpResponseErrorMessage
  | HttpRequestCreditMessage
  | WsAcceptedMessage
  | WsRejectedMessage
  | WsMessageMessage
  | WsCloseMessage
  | WsDrainMessage;

// ---- gateway → instance

export interface GatewayShutdownPayload {
  /** Why the gateway stops the instance, e.g. `stop`, `restart`, `protocol-mismatch`. */
  readonly reason: string;
  /** Graceful stop budget; the gateway escalates to SIGTERM / SIGKILL after it. */
  readonly budgetMs: number;
}

export interface HttpRequestPayload {
  readonly method: string;
  /** Absolute URL as the gateway received it. */
  readonly url: string;
  readonly headers: BridgeHeaders;
  /** True when `http.request.body` chunks (then `http.request.end`) follow. */
  readonly body: boolean;
  /** Principal the gateway authenticated (ADR 0054 §3); authorization happens in the instance. */
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
}

export interface WsOpenPayload {
  readonly url: string;
  readonly headers: BridgeHeaders;
  readonly principal?: ConsolePrincipal;
  readonly remoteAddress?: string;
}

/**
 * A user's credentials were revoked or narrowed (disabled, deleted, password changed, bindings
 * changed): the instance closes that principal's live connections (SSE, WebSocket).
 */
export interface PrincipalRevokedPayload {
  /** `ConsoleUserPrincipal.userId`. */
  readonly principalId: string;
  readonly reason?: string;
}

export type GatewayShutdownMessage = BridgeMessage<'shutdown', GatewayShutdownPayload>;
export type GatewayPrincipalRevokedMessage = BridgeMessage<'principal-revoked', PrincipalRevokedPayload>;
export type GatewayAddressesMessage = BridgeMessage<'host.addresses', { readonly addresses: readonly HttpHostAddress[] }>;
export type HttpRequestMessage = BridgeStreamMessage<'http.request', HttpRequestPayload>;
export type HttpRequestBodyMessage = BridgeStreamMessage<'http.request.body', BodyChunkPayload>;
export type HttpRequestEndMessage = BridgeStreamMessage<'http.request.end', Record<string, never>>;
export type HttpRequestAbortMessage = BridgeStreamMessage<'http.request.abort', StreamErrorPayload>;
export type HttpResponseCreditMessage = BridgeStreamMessage<'http.response.credit', CreditPayload>;
export type WsOpenMessage = BridgeStreamMessage<'ws.open', WsOpenPayload>;

export type GatewayToInstanceMessage =
  | GatewayShutdownMessage
  | GatewayPrincipalRevokedMessage
  | GatewayAddressesMessage
  | HttpRequestMessage
  | HttpRequestBodyMessage
  | HttpRequestEndMessage
  | HttpRequestAbortMessage
  | HttpResponseCreditMessage
  | WsOpenMessage
  | WsMessageMessage
  | WsCloseMessage
  | WsDrainMessage;

// ---- validation (messages are untrusted on both ends)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isText(value: unknown, max = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length <= max;
}

function hasValidId(message: Record<string, unknown>): boolean {
  return message.id === undefined || (typeof message.id === 'string' && message.id.length > 0 && message.id.length <= MAX_ID_LENGTH);
}

function hasStreamId(message: Record<string, unknown>): boolean {
  return typeof message.id === 'string' && message.id.length > 0 && message.id.length <= MAX_ID_LENGTH;
}

/** Bytes a head occupies (UTF-16 length; ASCII headers are exact). */
export function headSize(url: string, headers: BridgeHeaders): number {
  let size = url.length;
  for (const [name, value] of headers) size += name.length + value.length + 4;
  return size;
}

function isHeaders(value: unknown, limits: BridgeLimits, extra = 0): value is BridgeHeaders {
  if (!Array.isArray(value)) return false;
  let size = extra;
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    if (typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return false;
    size += entry[0].length + entry[1].length + 4;
    if (size > limits.maxHeadBytes) return false;
  }
  return true;
}

function isChunk(value: unknown, limits: BridgeLimits): value is Uint8Array {
  return value instanceof Uint8Array && value.byteLength <= limits.maxChunkBytes;
}

function isCredit(payload: Record<string, unknown>): boolean {
  return Number.isSafeInteger(payload.bytes) && (payload.bytes as number) > 0;
}

/** Upper bound of the UTF-8 size of a text frame. */
export function wsMessageSize(data: string | Uint8Array): number {
  return typeof data === 'string' ? data.length * 3 : data.byteLength;
}

function isWsData(value: unknown, limits: BridgeLimits): value is string | Uint8Array {
  if (typeof value === 'string') return value.length <= limits.maxWsMessageBytes;
  return value instanceof Uint8Array && value.byteLength <= limits.maxWsMessageBytes;
}

function isWsClose(payload: Record<string, unknown>): boolean {
  return Number.isSafeInteger(payload.code) && (payload.code as number) >= 1000 && (payload.code as number) <= 4999
    && isText(payload.reason, 123);
}

function isAddress(value: unknown): value is HttpHostAddress {
  if (!isRecord(value)) return false;
  return isText(value.host) && Number.isSafeInteger(value.port) && (value.protocol === 'http' || value.protocol === 'https')
    && typeof value.secure === 'boolean' && isText(value.origin);
}

/** Validates a principal forwarded by the gateway; `undefined` when malformed. */
export function parseBridgePrincipal(value: unknown): ConsolePrincipal | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'bootstrap') {
    return typeof value.open === 'boolean' ? Object.freeze({ kind: 'bootstrap', open: value.open }) : undefined;
  }
  if (value.kind !== 'user' && value.kind !== 'api-token') return undefined;
  if (!isText(value.userId) || !isText(value.username) || !isText(value.displayName) || !isText(value.credentialId)) return undefined;
  if (!Array.isArray(value.roles) || !value.roles.every((role) => isText(role))) return undefined;
  if (!Array.isArray(value.grants) || value.grants.length > 1024) return undefined;
  const grants = [];
  for (const grant of value.grants) {
    if (!isRecord(grant) || !isRecord(grant.scope)) return undefined;
    if (grant.role !== undefined && !isText(grant.role)) return undefined;
    const scope = grant.scope;
    let parsedScope;
    if (scope.kind === 'global') parsedScope = Object.freeze({ kind: 'global' as const });
    else if ((scope.kind === 'adapter' || scope.kind === 'endpoint') && isText(scope.key)) {
      parsedScope = Object.freeze({ kind: scope.kind, key: scope.key });
    } else return undefined;
    if (!Array.isArray(grant.permissions) || !grant.permissions.every((permission) => isText(permission))) return undefined;
    grants.push(Object.freeze({
      ...(grant.role !== undefined ? { role: grant.role as string } : {}),
      scope: parsedScope,
      permissions: Object.freeze([...grant.permissions as string[]]),
    }));
  }
  return Object.freeze({
    kind: value.kind,
    userId: value.userId,
    username: value.username,
    displayName: value.displayName,
    credentialId: value.credentialId,
    grants: Object.freeze(grants),
    roles: Object.freeze([...value.roles as string[]]),
  });
}

function isRouteTable(value: unknown, limits: BridgeLimits): value is BridgeRouteTable {
  if (!isRecord(value)) return false;
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false;
  if (value.generation !== undefined && !isFiniteNonNegative(value.generation)) return false;
  if (!isText(value.apiBase)) return false;
  if (!Array.isArray(value.http) || !Array.isArray(value.ws)) return false;
  if (value.http.length + value.ws.length > limits.maxRoutes) return false;
  for (const route of value.http) {
    if (!isRecord(route) || !isText(route.method, 16) || !isText(route.pattern, 2048)) return false;
    if (route.meta !== undefined && !isRecord(route.meta)) return false;
  }
  for (const route of value.ws) {
    if (!isRecord(route) || !isText(route.path, 2048) || (route.auth !== 'host' && route.auth !== 'protocol')) return false;
  }
  return true;
}

const MAX_CATALOG_ENTRIES = 4096;
const PLUGIN_PERMISSION_LEVELS: ReadonlySet<unknown> = new Set(['read', 'operate', 'manage']);

function isCatalogEntry(value: unknown): value is ConsolePluginPermissionInfo {
  if (!isRecord(value)) return false;
  if (!isText(value.id, 256) || !PLUGIN_PERMISSION_LEVELS.has(value.level) || typeof value.declared !== 'boolean') return false;
  if (value.description !== undefined && !isText(value.description)) return false;
  return Array.isArray(value.owners) && value.owners.length <= 256 && value.owners.every((owner) => isText(owner, 256));
}

function isAuditEntry(value: unknown): value is ConsoleAuditEntry {
  if (!isRecord(value)) return false;
  if (!isText(value.actor, 256) || !isText(value.action, 512)) return false;
  if (value.outcome !== 'ok' && value.outcome !== 'denied' && value.outcome !== 'error') return false;
  if (value.target !== undefined && !isText(value.target, 512)) return false;
  if (value.ip !== undefined && !isText(value.ip, 256)) return false;
  if (value.detail !== undefined && !isRecord(value.detail)) return false;
  return true;
}

function isOptionalPrincipal(value: unknown): boolean {
  return value === undefined || parseBridgePrincipal(value) !== undefined;
}

function isOptionalRemote(value: unknown): boolean {
  return value === undefined || isText(value, 256);
}

/** Validates an untrusted message received from the instance. */
export function parseInstanceMessage(
  value: unknown,
  limits: BridgeLimits = DEFAULT_BRIDGE_LIMITS,
): InstanceToGatewayMessage | undefined {
  if (!isRecord(value) || !hasValidId(value) || !isRecord(value.payload)) return undefined;
  const payload = value.payload;
  switch (value.type) {
    case 'ready':
      if (!Number.isSafeInteger(payload.version)) return undefined;
      if (!Number.isSafeInteger(payload.pid)) return undefined;
      if (payload.generation !== undefined && !isFiniteNonNegative(payload.generation)) return undefined;
      if (payload.routes !== undefined && !isRouteTable(payload.routes, limits)) return undefined;
      return value as unknown as InstanceReadyMessage;
    case 'restart-request':
      if (typeof payload.reason !== 'string') return undefined;
      return value as unknown as InstanceRestartRequestMessage;
    case 'routes':
      return isRouteTable(payload.table, limits) ? value as unknown as InstanceRoutesMessage : undefined;
    case 'catalog': {
      const list = payload.pluginPermissions;
      if (!Array.isArray(list) || list.length > MAX_CATALOG_ENTRIES || !list.every(isCatalogEntry)) return undefined;
      return value as unknown as InstanceCatalogMessage;
    }
    case 'audit':
      return isAuditEntry(payload.entry) ? value as unknown as InstanceAuditMessage : undefined;
    default:
      break;
  }
  if (!hasStreamId(value)) return undefined;
  switch (value.type) {
    case 'http.response.head':
      if (!Number.isSafeInteger(payload.status) || (payload.status as number) < 200 || (payload.status as number) > 599) return undefined;
      if (payload.statusText !== undefined && !isText(payload.statusText)) return undefined;
      if (typeof payload.body !== 'boolean' || !isHeaders(payload.headers, limits)) return undefined;
      return value as unknown as HttpResponseHeadMessage;
    case 'http.response.body':
      return isChunk(payload.chunk, limits) ? value as unknown as HttpResponseBodyMessage : undefined;
    case 'http.response.end':
    case 'ws.accepted':
      return value as unknown as InstanceToGatewayMessage;
    case 'http.response.error':
      return isText(payload.message) ? value as unknown as HttpResponseErrorMessage : undefined;
    case 'http.request.credit':
    case 'ws.drain':
      return isCredit(payload) ? value as unknown as InstanceToGatewayMessage : undefined;
    case 'ws.rejected':
      return [401, 403, 404, 503].includes(payload.status as number) ? value as unknown as WsRejectedMessage : undefined;
    case 'ws.message':
      return isWsData(payload.data, limits) ? value as unknown as WsMessageMessage : undefined;
    case 'ws.close':
      return isWsClose(payload) ? value as unknown as WsCloseMessage : undefined;
    default:
      return undefined;
  }
}

/** Validates an untrusted message received from the gateway. */
export function parseGatewayMessage(
  value: unknown,
  limits: BridgeLimits = DEFAULT_BRIDGE_LIMITS,
): GatewayToInstanceMessage | undefined {
  if (!isRecord(value) || !hasValidId(value) || !isRecord(value.payload)) return undefined;
  const payload = value.payload;
  switch (value.type) {
    case 'shutdown':
      if (typeof payload.reason !== 'string' || !isFiniteNonNegative(payload.budgetMs)) return undefined;
      return value as unknown as GatewayShutdownMessage;
    case 'host.addresses':
      if (!Array.isArray(payload.addresses) || payload.addresses.length > 64 || !payload.addresses.every(isAddress)) return undefined;
      return value as unknown as GatewayAddressesMessage;
    case 'principal-revoked':
      if (!isText(payload.principalId) || payload.principalId.length === 0) return undefined;
      if (payload.reason !== undefined && !isText(payload.reason, 64)) return undefined;
      return value as unknown as GatewayPrincipalRevokedMessage;
    default:
      break;
  }
  if (!hasStreamId(value)) return undefined;
  switch (value.type) {
    case 'http.request':
      if (!isText(payload.method, 16) || !/^[A-Za-z]+$/u.test(payload.method)) return undefined;
      if (!isText(payload.url, limits.maxHeadBytes) || typeof payload.body !== 'boolean') return undefined;
      if (!isHeaders(payload.headers, limits, payload.url.length)) return undefined;
      if (!isOptionalPrincipal(payload.principal) || !isOptionalRemote(payload.remoteAddress)) return undefined;
      return value as unknown as HttpRequestMessage;
    case 'ws.open':
      if (!isText(payload.url, limits.maxHeadBytes) || !isHeaders(payload.headers, limits, payload.url.length)) return undefined;
      if (!isOptionalPrincipal(payload.principal) || !isOptionalRemote(payload.remoteAddress)) return undefined;
      return value as unknown as WsOpenMessage;
    case 'http.request.body':
      return isChunk(payload.chunk, limits) ? value as unknown as HttpRequestBodyMessage : undefined;
    case 'http.request.end':
      return value as unknown as HttpRequestEndMessage;
    case 'http.request.abort':
      return isText(payload.message) ? value as unknown as HttpRequestAbortMessage : undefined;
    case 'http.response.credit':
    case 'ws.drain':
      return isCredit(payload) ? value as unknown as GatewayToInstanceMessage : undefined;
    case 'ws.message':
      return isWsData(payload.data, limits) ? value as unknown as WsMessageMessage : undefined;
    case 'ws.close':
      return isWsClose(payload) ? value as unknown as WsCloseMessage : undefined;
    default:
      return undefined;
  }
}

/** Headers as a bridge header list (repeated `set-cookie` stays separate). */
export function toBridgeHeaders(headers: Headers): BridgeHeaders {
  const list: (readonly [string, string])[] = [];
  for (const [name, value] of headers) list.push([name, value]);
  return list;
}

export function fromBridgeHeaders(list: BridgeHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of list) {
    try {
      headers.append(name, value);
    } catch { /* not a valid Fetch header: skip */ }
  }
  return headers;
}
