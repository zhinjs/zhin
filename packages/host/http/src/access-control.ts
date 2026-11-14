import {
  CONSOLE_DENIAL_REASONS,
  CONSOLE_PERMISSION_LIST,
  CONSOLE_UNKNOWN_RPC_CODE,
  CONSOLE_WRITE_PERMISSIONS,
  expandPluginPermissions,
  grantsAllow,
  grantsAllowAlsoRequired,
  isPluginConsoleRpcType,
  resolveConsoleHttpPermission,
  resolveConsoleRpcPermission,
  resolveConsoleWsPermission,
  type ConsoleDenialReason,
  type ConsoleGrant,
  type ConsolePermission,
  type ConsolePluginPermissionInfo,
  type ConsolePluginPermissionLevelResolver,
  type ConsoleRpcPermissionRule,
  type ConsoleScopeTarget,
} from '@zhin.js/console-protocol';
import { hasForwardingHeaders } from './trust-proxy.js';

/**
 * Console principals (ADR 0049 §1):
 * - `bootstrap`: the `http.token` before the first owner exists (`open: false`), or a Host
 *   without any credential before setup (`open: true`, today's local behaviour).
 * - `user`: a session from `/auth/login`; `api-token`: a user-issued long-lived token.
 */
export type ConsolePrincipal = ConsoleBootstrapPrincipal | ConsoleUserPrincipal;

export interface ConsoleBootstrapPrincipal {
  readonly kind: 'bootstrap';
  /** No credential configured at all: the Host is open (local) until setup. */
  readonly open: boolean;
}

export interface ConsoleUserPrincipal {
  readonly kind: 'user' | 'api-token';
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  /** Session id (token hash) or API token id; never the bearer itself. */
  readonly credentialId: string;
  readonly grants: readonly ConsoleGrant[];
  /** Role names across all bindings (matched against Page `requiredRoles`). */
  readonly roles: readonly string[];
}

export interface ConsoleRequestMeta {
  readonly ip?: string;
  readonly userAgent?: string;
  /**
   * The request carried proxy forwarding headers (`X-Forwarded-For` / `Forwarded`). Such a
   * request never counts as local: an open Host (no bootstrap token, no owner) refuses it.
   */
  readonly forwarded?: boolean;
  /**
   * An in-process caller with no network peer (tests, embedding), set explicitly by the caller.
   * An open Host admits it like a loopback peer; a request without `ip` and without this marker
   * is never local.
   */
  readonly inProcess?: boolean;
}

export interface ConsoleAuditEntry {
  readonly actor: string;
  readonly action: string;
  readonly target?: string;
  readonly outcome: 'ok' | 'denied' | 'error';
  /** Never values: RPC type, target, parameter key names. */
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly ip?: string;
}

/**
 * Pluggable user/session backend supplied by the composition root (`basic/cli`), so this
 * package never imports the database layer.
 */
export interface ConsoleAccessProvider {
  /** True once an enabled user with a global `owner` binding exists. */
  initialized(): boolean;
  /** Resolves a session or API token. Unknown, expired or revoked → null. */
  authenticate(token: string, meta: ConsoleRequestMeta): Promise<ConsoleUserPrincipal | null>;
  audit?(entry: ConsoleAuditEntry): void;
}

export function isUserPrincipal(principal: ConsolePrincipal | undefined): principal is ConsoleUserPrincipal {
  return principal?.kind === 'user' || principal?.kind === 'api-token';
}

/** User id and credential id of the gateway control-socket principal (ADR 0054 §6). */
export const LOCAL_SOCKET_USER_ID = 'local';
export const LOCAL_SOCKET_CREDENTIAL_ID = 'local-socket';

/**
 * The principal of a request from the project owner's CLI over `.zhin/gateway.sock` (no token).
 * Sessions and API tokens never carry this credential id (theirs are token hashes / token ids).
 */
export function isLocalSocketPrincipal(principal: ConsolePrincipal | undefined): boolean {
  return principal?.kind === 'user' && principal.userId === LOCAL_SOCKET_USER_ID
    && principal.credentialId === LOCAL_SOCKET_CREDENTIAL_ID;
}

/** A user principal with a global `owner` binding (the local socket principal is one). */
export function isGlobalOwnerPrincipal(principal: ConsolePrincipal | undefined): boolean {
  return isUserPrincipal(principal)
    && principal.grants.some((grant) => grant.role === 'owner' && grant.scope.kind === 'global');
}

/**
 * Whether the request carried an explicit credential: a user session / API token, or the
 * still-valid bootstrap token (`{ kind: 'bootstrap', open: false }`). An open Host is not explicit.
 */
export function isExplicitConsolePrincipal(principal: ConsolePrincipal | undefined): boolean {
  return isUserPrincipal(principal) || (principal?.kind === 'bootstrap' && !principal.open);
}

export function auditActor(principal: ConsolePrincipal | undefined): string {
  if (!principal) return 'anonymous';
  if (principal.kind === 'bootstrap') return 'bootstrap';
  return principal.kind === 'user' ? `user:${principal.userId}` : `api-token:${principal.credentialId}`;
}

/** Audit/session metadata of a request: peer address and a bounded user agent. */
export function requestMeta(
  request: { readonly headers: Headers },
  remoteAddress?: string,
  options: { readonly inProcess?: boolean } = {},
): ConsoleRequestMeta {
  const agent = request.headers.get('user-agent');
  return Object.freeze({
    ...(remoteAddress ? { ip: remoteAddress } : {}),
    ...(options.inProcess === true && !remoteAddress ? { inProcess: true } : {}),
    ...(typeof agent === 'string' ? { userAgent: agent.slice(0, 256) } : {}),
    ...(hasForwardingHeaders(request.headers) ? { forwarded: true } : {}),
  });
}

/**
 * Whether the principal holds `permission` at `target` (bootstrap: only an open Host). Plugin
 * permissions also match by level; `levelOf` supplies declared levels (default: inferred).
 */
export function principalAllows(
  principal: ConsolePrincipal | undefined,
  permission: string,
  target?: ConsoleScopeTarget,
  levelOf?: ConsolePluginPermissionLevelResolver,
): boolean {
  if (!principal) return false;
  if (principal.kind === 'bootstrap') return principal.open;
  return grantsAllow(principal.grants, permission, target, levelOf);
}

/**
 * Permissions held through global bindings, sorted (what `/auth/me` and page gating use).
 * With a plugin permission catalog, `plugin.perms.<level>` expands to the catalog ids of that level.
 */
export function globalPermissions(
  principal: ConsolePrincipal | undefined,
  pluginPermissions: Iterable<Pick<ConsolePluginPermissionInfo, 'id' | 'level'>> = [],
): readonly string[] {
  if (!principal) return Object.freeze([]);
  if (principal.kind === 'bootstrap') return principal.open ? CONSOLE_PERMISSION_LIST : Object.freeze([]);
  const held = new Set<string>();
  for (const grant of principal.grants) {
    if (grant.scope.kind === 'global') for (const permission of grant.permissions) held.add(permission);
  }
  return expandPluginPermissions([...held], pluginPermissions);
}

export type ConsoleRpcDecision =
  | Readonly<{
      allowed: true; rule: ConsoleRpcPermissionRule | null; permission: ConsolePermission | null; write: boolean;
      /**
       * Plugin Console RPC for a signed-in principal: admitted here only so the plugin RPC
       * dispatcher can check the method's own (or page / fallback) permissions. The caller must
       * deny when no plugin dispatcher answers.
       */
      delegated?: true;
    }>
  | Readonly<{
      allowed: false;
      /**
       * `unknown_rpc`: the Host has no handler and no permission entry for the type (zhinjs/zhin#1250).
       * Nothing runs; it is not a security refusal and callers do not audit it (see
       * {@link isAuditedRpcDenial}). Every other code is a refusal that is audited.
       */
      code: 'setup_required' | 'unmapped' | 'forbidden' | typeof CONSOLE_UNKNOWN_RPC_CODE;
      error: string;
      permission: ConsolePermission | null;
      /** Audit `detail.reason`; absent for `unknown_rpc`. */
      reason?: ConsoleDenialReason;
    }>;

export interface AuthorizeConsoleRpcOptions {
  /**
   * Whether this Host has a handler for an RPC type that is missing from the permission map. True
   * (or no predicate) keeps the audited `unmapped` refusal — a handler without a permission entry
   * is a development error; false answers `unknown_rpc`. Mapped types never consult it.
   */
  readonly registered?: (type: string) => boolean;
}

/** Whether a refused RPC is written to the audit log (`unknown_rpc` is not). */
export function isAuditedRpcDenial(decision: ConsoleRpcDecision): boolean {
  return !decision.allowed && decision.code !== CONSOLE_UNKNOWN_RPC_CODE;
}

/** Error text of an unknown RPC: the (truncated) type and nothing else. */
export function unknownConsoleRpcError(type: unknown): string {
  return `RPC "${String(type ?? '').slice(0, 64)}" 不存在`;
}

/** RPC authorization for one principal and message (deny by default). */
export function authorizeConsoleRpc(
  principal: ConsolePrincipal,
  message: Readonly<Record<string, unknown>>,
  options: AuthorizeConsoleRpcOptions = {},
): ConsoleRpcDecision {
  const rule = resolveConsoleRpcPermission(message.type, message);
  const permission = rule ? (rule.kind === 'exact' ? rule.permission : rule.read) : null;
  if (principal.kind === 'bootstrap') {
    if (principal.open) {
      return Object.freeze({ allowed: true, rule, permission, write: rule ? isWriteRule(rule) : true });
    }
    return Object.freeze({
      allowed: false, code: 'setup_required', error: '请先完成初始化：创建第一个所有者', permission,
      reason: CONSOLE_DENIAL_REASONS.SETUP_REQUIRED,
    });
  }
  if (!rule) {
    const type = typeof message.type === 'string' ? message.type : '';
    if (options.registered && !options.registered(type)) {
      return Object.freeze({ allowed: false, code: CONSOLE_UNKNOWN_RPC_CODE, error: unknownConsoleRpcError(message.type), permission: null });
    }
    return Object.freeze({
      allowed: false, code: 'unmapped', error: `RPC "${String(message.type ?? '')}" 未登记权限`, permission: null,
      reason: CONSOLE_DENIAL_REASONS.UNMAPPED_PERMISSION,
    });
  }
  if (isPluginConsoleRpcType(message.type)) {
    return Object.freeze({ allowed: true, rule, permission, write: isWriteRule(rule), delegated: true });
  }
  if (!grantsAllow(principal.grants, permission!, rule.target)) {
    return Object.freeze({
      allowed: false, code: 'forbidden', error: `缺少权限 ${permission}`, permission,
      reason: grantsDenialReason(principal.grants, permission!),
    });
  }
  // `alsoRequires` is held globally (same semantics as grantsAllowAlsoRequired): find the first missing one for the denial reason.
  const missing = rule.kind === 'exact' && !grantsAllowAlsoRequired(principal.grants, rule)
    ? rule.alsoRequires?.find(extra => !grantsAllowAlsoRequired(principal.grants, { ...rule, alsoRequires: [extra] }))
    : undefined;
  if (missing) {
    return Object.freeze({
      allowed: false, code: 'forbidden', error: `缺少权限 ${missing}`, permission,
      reason: grantsDenialReason(principal.grants, missing),
    });
  }
  return Object.freeze({ allowed: true, rule, permission, write: isWriteRule(rule) });
}

/**
 * Why grants refuse `permission` at a target: `scope_denied` when some binding holds it at another
 * adapter / endpoint, else `insufficient_permission`.
 */
export function grantsDenialReason(grants: readonly ConsoleGrant[], permission: string): ConsoleDenialReason {
  return grants.some(grant => grant.scope.kind !== 'global' && grant.permissions.includes(permission))
    ? CONSOLE_DENIAL_REASONS.SCOPE_DENIED
    : CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION;
}

function isWriteRule(rule: ConsoleRpcPermissionRule): boolean {
  return rule.kind === 'exact' ? CONSOLE_WRITE_PERMISSIONS.has(rule.permission) : false;
}

/**
 * For plugin RPC: whether the principal holds the rule's write permission (`feature.configure`,
 * or `endpoint.manage` for adapter account methods) at its target. The plugin RPC dispatcher
 * authorizes each method itself; this is only the catalog fallback.
 */
export function pluginRpcWriteAllowed(principal: ConsolePrincipal, rule: ConsoleRpcPermissionRule | null): boolean {
  if (principal.kind === 'bootstrap') return principal.open;
  if (!rule) return false;
  const permission = rule.kind === 'exact' ? rule.permission : rule.write;
  return grantsAllow(principal.grants, permission, rule.target) && grantsAllowAlsoRequired(principal.grants, rule);
}

export type ConsoleHttpDecision =
  | Readonly<{ allowed: true; permission: string | null }>
  | Readonly<{
      allowed: false; status: 401 | 403; code: 'unauthorized' | 'forbidden' | 'setup_required'; error: string; permission: string | null;
      /** Audit `detail.reason`. */
      reason: ConsoleDenialReason;
    }>;

/**
 * HTTP authorization of a route under the API base. `principal` is undefined when no valid
 * credential was presented.
 */
export function authorizeConsoleHttp(
  principal: ConsolePrincipal | undefined,
  method: string,
  relativePath: string,
): ConsoleHttpDecision {
  const rule = resolveConsoleHttpPermission(method, relativePath);
  const permission = rule?.permission ?? null;
  if (rule?.permission === 'public') return Object.freeze({ allowed: true, permission });
  if (!principal) {
    return Object.freeze({ allowed: false, status: 401, code: 'unauthorized', error: 'Invalid or missing token', permission, reason: CONSOLE_DENIAL_REASONS.NOT_AUTHENTICATED });
  }
  if (principal.kind === 'bootstrap') {
    if (principal.open || rule?.permission === 'bootstrap') return Object.freeze({ allowed: true, permission });
    return Object.freeze({ allowed: false, status: 403, code: 'setup_required', error: '初始化令牌只能用于创建第一个所有者', permission, reason: CONSOLE_DENIAL_REASONS.SETUP_REQUIRED });
  }
  if (!rule) {
    return Object.freeze({ allowed: false, status: 403, code: 'forbidden', error: 'Route is not registered with a Console permission', permission: null, reason: CONSOLE_DENIAL_REASONS.UNMAPPED_ROUTE });
  }
  if (rule.permission === 'rpc' || rule.permission === 'authenticated' || rule.permission === 'bootstrap') {
    return Object.freeze({ allowed: true, permission });
  }
  // Scoped permissions over plain HTTP have no knowable target: a global binding is required.
  if (grantsAllow(principal.grants, rule.permission)) return Object.freeze({ allowed: true, permission });
  return Object.freeze({
    allowed: false, status: 403, code: 'forbidden', error: `缺少权限 ${rule.permission}`, permission,
    reason: CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION,
  });
}

/** WebSocket upgrade authorization for non-bootstrap principals. */
/** Audit `detail.reason` of a WebSocket {@link authorizeConsoleWebSocket} refused. */
export function webSocketDenialReason(principal: ConsolePrincipal, pathname: string): ConsoleDenialReason {
  if (principal.kind === 'bootstrap') return CONSOLE_DENIAL_REASONS.SETUP_REQUIRED;
  return resolveConsoleWsPermission(pathname) === null
    ? CONSOLE_DENIAL_REASONS.UNMAPPED_ROUTE
    : CONSOLE_DENIAL_REASONS.INSUFFICIENT_PERMISSION;
}

export function authorizeConsoleWebSocket(principal: ConsolePrincipal, pathname: string): boolean {
  // Only the Console's own sockets are host-authenticated; plugin sockets use `auth: 'protocol'`.
  const permission = resolveConsoleWsPermission(pathname);
  if (principal.kind === 'bootstrap') return principal.open;
  return permission !== null && grantsAllow(principal.grants, permission);
}

/**
 * JSON length of the detail of one audit entry. The gateway stores at most 4096 characters of
 * JSON detail; statements are cut so the whole detail stays below this budget once serialised
 * (escapes such as `\n` count twice), so the stored detail always parses.
 */
export const AUDIT_DETAIL_JSON_LIMIT = 3_500;

export interface RpcAuditOptions {
  /**
   * Replaces literal values in SQL text (`'…'`) before it is recorded, with the dialect's own
   * lexing (the database Host's `redactSql`). Without it no statement text is recorded at all.
   */
  readonly redactSql?: (sql: string) => string;
}

function statementTexts(message: Readonly<Record<string, unknown>>, reply: Readonly<Record<string, unknown>> | undefined): string[] {
  if (message.type === 'db:execute' || message.type === 'db:query') return typeof message.sql === 'string' && message.sql ? [message.sql] : [];
  const data = reply?.data && typeof reply.data === 'object' ? reply.data as Record<string, unknown> : undefined;
  return (Array.isArray(data?.statements) ? data.statements as unknown[] : []).filter((entry): entry is string => typeof entry === 'string' && !!entry);
}

/**
 * Statement text of Console SQL (`db:query` / `db:execute`, the DDL `db:schema:apply` ran or
 * would have run), literals redacted; result rows are never recorded.
 */
function databaseStatementDetail(
  message: Readonly<Record<string, unknown>>,
  reply: Readonly<Record<string, unknown>> | undefined,
  options: RpcAuditOptions | undefined,
): Record<string, unknown> {
  if (message.type !== 'db:execute' && message.type !== 'db:query' && message.type !== 'db:schema:apply') return {};
  const change = message.type === 'db:schema:apply' && message.change && typeof message.change === 'object' ? message.change as Record<string, unknown> : {};
  const texts = statementTexts(message, reply);
  const redact = options?.redactSql;
  return {
    ...(message.type === 'db:execute' && message.dryRun === true ? { dryRun: true } : {}),
    ...(typeof change.kind === 'string' ? { change: change.kind.slice(0, 64) } : {}),
    ...(typeof change.table === 'string' ? { table: change.table.slice(0, 256) } : {}),
    ...(texts.length && redact
      ? { statements: texts.map(text => { try { return redact(text); } catch { return '[unavailable]'; } }) }
      : texts.length ? { statementLength: texts.reduce((total, text) => total + text.length, 0) } : {}),
  };
}

/** Cuts the longest statement until the serialised detail fits {@link AUDIT_DETAIL_JSON_LIMIT}. */
function fitAuditDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const statements = Array.isArray(detail.statements) ? [...detail.statements as string[]] : undefined;
  if (!statements) return detail;
  let truncated = false;
  for (;;) {
    const candidate = { ...detail, statements, ...(truncated ? { truncated: true } : {}) };
    const overflow = JSON.stringify(candidate).length - AUDIT_DETAIL_JSON_LIMIT;
    if (overflow <= 0) return { ...candidate, statements: Object.freeze(statements) };
    truncated = true;
    let longest = 0;
    for (let index = 1; index < statements.length; index += 1) if (statements[index]!.length > statements[longest]!.length) longest = index;
    const text = statements[longest]!;
    if (text.length <= 1) { statements.splice(longest, 1); continue; }
    statements[longest] = `${text.slice(0, Math.max(0, text.length - overflow - 1))}…`;
  }
}

/**
 * Audit detail for an RPC: type, target and parameter key names only — plus the statement text
 * of Console database writes (pass the reply so the DDL a schema change ran is recorded), with
 * literals redacted by `options.redactSql`.
 */
export function rpcAuditDetail(
  message: Readonly<Record<string, unknown>>,
  reply?: Readonly<Record<string, unknown>>,
  options?: RpcAuditOptions,
): Readonly<Record<string, unknown>> {
  const data = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? Object.keys(message.data as Record<string, unknown>).sort()
    : [];
  const keys = Object.keys(message).filter(key => key !== 'type' && key !== 'requestId' && key !== 'data').sort();
  return Object.freeze(fitAuditDetail({
    type: String(message.type ?? '').slice(0, 256),
    keys: Object.freeze([...new Set([...keys, ...data])].slice(0, 64).map(key => key.slice(0, 128))),
    ...databaseStatementDetail(message, reply, options),
    ...envDetail(message),
  }));
}

const auditName = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value ? value.slice(0, max) : undefined;

/**
 * Which dotenv file and variable names an `env:reveal` / `env:save` touched (issue #1250). Never a
 * value: `changes[].value` and `content` are not read.
 */
function envDetail(message: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (message.type !== 'env:reveal' && message.type !== 'env:save') return {};
  const data = message.data && typeof message.data === 'object' && !Array.isArray(message.data) ? message.data as Record<string, unknown> : {};
  const pick = (key: string) => message[key] ?? data[key];
  const file = auditName(pick('filename'), 64);
  if (message.type === 'env:reveal') {
    const key = auditName(pick('key'), 128);
    return { ...(file ? { file } : {}), ...(key ? { key } : {}) };
  }
  const changes = Array.isArray(pick('changes')) ? pick('changes') as unknown[] : undefined;
  if (!changes) return { ...(file ? { file } : {}), ...(pick('content') !== undefined ? { mode: 'replace' } : {}) };
  const set: string[] = [];
  const deleted: string[] = [];
  for (const change of changes.slice(0, 64)) {
    if (!change || typeof change !== 'object') continue;
    const key = auditName((change as Record<string, unknown>).key, 128);
    if (key) ((change as Record<string, unknown>).delete === true ? deleted : set).push(key);
  }
  return {
    ...(file ? { file } : {}),
    set: Object.freeze(set),
    deleted: Object.freeze(deleted),
    ...(changes.length > 64 ? { truncated: true } : {}),
  };
}

export function rpcAuditTarget(rule: ConsoleRpcPermissionRule | null): string | undefined {
  if (!rule) return undefined;
  const target = rule.target;
  if (target.kind === 'adapter') return `adapter:${target.adapter}`;
  if (target.kind === 'endpoint') return `endpoint:${target.adapter}/${target.endpoint}`;
  return undefined;
}
