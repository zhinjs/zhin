import {
  CONSOLE_PERMISSION_LIST,
  CONSOLE_WRITE_PERMISSIONS,
  expandPluginPermissions,
  grantsAllow,
  isPluginConsoleRpcType,
  resolveConsoleHttpPermission,
  resolveConsoleRpcPermission,
  resolveConsoleWsPermission,
  type ConsoleGrant,
  type ConsolePermission,
  type ConsolePluginPermissionInfo,
  type ConsolePluginPermissionLevelResolver,
  type ConsoleRpcPermissionRule,
  type ConsoleScopeTarget,
} from '@zhin.js/console-protocol';

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

export function auditActor(principal: ConsolePrincipal | undefined): string {
  if (!principal) return 'anonymous';
  if (principal.kind === 'bootstrap') return 'bootstrap';
  return principal.kind === 'user' ? `user:${principal.userId}` : `api-token:${principal.credentialId}`;
}

/** Audit/session metadata of a request: peer address and a bounded user agent. */
export function requestMeta(
  request: { readonly headers: Headers },
  remoteAddress?: string,
): ConsoleRequestMeta {
  const agent = request.headers.get('user-agent');
  return Object.freeze({
    ...(remoteAddress ? { ip: remoteAddress } : {}),
    ...(typeof agent === 'string' ? { userAgent: agent.slice(0, 256) } : {}),
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
  | Readonly<{ allowed: false; code: 'setup_required' | 'unmapped' | 'forbidden'; error: string; permission: ConsolePermission | null }>;

/** RPC authorization for one principal and message (deny by default). */
export function authorizeConsoleRpc(principal: ConsolePrincipal, message: Readonly<Record<string, unknown>>): ConsoleRpcDecision {
  const rule = resolveConsoleRpcPermission(message.type, message);
  const permission = rule ? (rule.kind === 'exact' ? rule.permission : rule.read) : null;
  if (principal.kind === 'bootstrap') {
    if (principal.open) {
      return Object.freeze({ allowed: true, rule, permission, write: rule ? isWriteRule(rule) : true });
    }
    return Object.freeze({ allowed: false, code: 'setup_required', error: '请先完成初始化：创建第一个所有者', permission });
  }
  if (!rule) {
    return Object.freeze({ allowed: false, code: 'unmapped', error: `RPC "${String(message.type ?? '')}" 未登记权限`, permission: null });
  }
  if (isPluginConsoleRpcType(message.type)) {
    return Object.freeze({ allowed: true, rule, permission, write: isWriteRule(rule), delegated: true });
  }
  if (!grantsAllow(principal.grants, permission!, rule.target)) {
    return Object.freeze({ allowed: false, code: 'forbidden', error: `缺少权限 ${permission}`, permission });
  }
  return Object.freeze({ allowed: true, rule, permission, write: isWriteRule(rule) });
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
  return grantsAllow(principal.grants, permission, rule.target);
}

export type ConsoleHttpDecision =
  | Readonly<{ allowed: true; permission: string | null }>
  | Readonly<{ allowed: false; status: 401 | 403; code: 'unauthorized' | 'forbidden' | 'setup_required'; error: string; permission: string | null }>;

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
    return Object.freeze({ allowed: false, status: 401, code: 'unauthorized', error: 'Invalid or missing token', permission });
  }
  if (principal.kind === 'bootstrap') {
    if (principal.open || rule?.permission === 'bootstrap') return Object.freeze({ allowed: true, permission });
    return Object.freeze({ allowed: false, status: 403, code: 'setup_required', error: '初始化令牌只能用于创建第一个所有者', permission });
  }
  if (!rule) {
    return Object.freeze({ allowed: false, status: 403, code: 'forbidden', error: 'Route is not registered with a Console permission', permission: null });
  }
  if (rule.permission === 'rpc' || rule.permission === 'authenticated' || rule.permission === 'bootstrap') {
    return Object.freeze({ allowed: true, permission });
  }
  // Scoped permissions over plain HTTP have no knowable target: a global binding is required.
  if (grantsAllow(principal.grants, rule.permission)) return Object.freeze({ allowed: true, permission });
  return Object.freeze({ allowed: false, status: 403, code: 'forbidden', error: `缺少权限 ${rule.permission}`, permission });
}

/** WebSocket upgrade authorization for non-bootstrap principals. */
export function authorizeConsoleWebSocket(principal: ConsolePrincipal, pathname: string): boolean {
  // Only the Console's own sockets are host-authenticated; plugin sockets use `auth: 'protocol'`.
  const permission = resolveConsoleWsPermission(pathname);
  if (principal.kind === 'bootstrap') return principal.open;
  return permission !== null && grantsAllow(principal.grants, permission);
}

/** Audit detail for an RPC: type, target and parameter key names only. */
export function rpcAuditDetail(message: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const data = message.data && typeof message.data === 'object' && !Array.isArray(message.data)
    ? Object.keys(message.data as Record<string, unknown>).sort()
    : [];
  const keys = Object.keys(message).filter(key => key !== 'type' && key !== 'requestId' && key !== 'data').sort();
  return Object.freeze({ type: String(message.type ?? ''), keys: Object.freeze([...new Set([...keys, ...data])]) });
}

export function rpcAuditTarget(rule: ConsoleRpcPermissionRule | null): string | undefined {
  if (!rule) return undefined;
  const target = rule.target;
  if (target.kind === 'adapter') return `adapter:${target.adapter}`;
  if (target.kind === 'endpoint') return `endpoint:${target.adapter}/${target.endpoint}`;
  return undefined;
}
