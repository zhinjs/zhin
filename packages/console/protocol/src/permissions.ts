/**
 * Console access control catalog (ADR 0049): permission strings, built-in roles, the
 * RPC / HTTP route → permission map and role-binding scope rules shared by Host and Console.
 *
 * This module must not import from `./index.js` (the barrel re-exports it), so RPC names
 * are spelled as literals; protocol tests assert every catalog entry is mapped.
 */
import { FEATURE_RPC_PERMISSIONS } from './feature.js';

export const CONSOLE_PERMISSIONS = Object.freeze({
  STATUS_VIEW: 'status.view',
  ENDPOINT_VIEW: 'endpoint.view',
  ENDPOINT_OPERATE: 'endpoint.operate',
  ENDPOINT_MANAGE: 'endpoint.manage',
  FEATURE_VIEW: 'feature.view',
  FEATURE_CONFIGURE: 'feature.configure',
  FEATURE_TOGGLE: 'feature.toggle',
  PLUGIN_MANAGE: 'plugin.manage',
  AGENT_VIEW: 'agent.view',
  AGENT_CONFIGURE: 'agent.configure',
  OPS_CONFIG_READ: 'ops.config.read',
  OPS_CONFIG_WRITE: 'ops.config.write',
  OPS_ENV_READ: 'ops.env.read',
  OPS_ENV_WRITE: 'ops.env.write',
  OPS_DATABASE_READ: 'ops.database.read',
  OPS_DATABASE_WRITE: 'ops.database.write',
  OPS_SCHEDULE_READ: 'ops.schedule.read',
  OPS_SCHEDULE_WRITE: 'ops.schedule.write',
  OPS_FILES_READ: 'ops.files.read',
  OPS_FILES_WRITE: 'ops.files.write',
  OPS_RESTART: 'ops.restart',
  OPS_TERMINAL: 'ops.terminal',
  IAM_VIEW: 'iam.view',
  IAM_MANAGE: 'iam.manage',
  MCP_ACCESS: 'mcp.access',
  A2A_ACCESS: 'a2a.access',
} as const);

export type ConsolePermission = (typeof CONSOLE_PERMISSIONS)[keyof typeof CONSOLE_PERMISSIONS];

export const CONSOLE_PERMISSION_LIST: readonly ConsolePermission[] = Object.freeze(
  Object.values(CONSOLE_PERMISSIONS),
);

const knownPermissions: ReadonlySet<string> = new Set(CONSOLE_PERMISSION_LIST);

export function isConsolePermission(value: unknown): value is ConsolePermission {
  return typeof value === 'string' && knownPermissions.has(value);
}

/** Permissions that a role binding's adapter / endpoint scope can narrow (ADR 0049 §3). */
export const CONSOLE_SCOPED_PERMISSIONS: ReadonlySet<ConsolePermission> = new Set<ConsolePermission>([
  'endpoint.view',
  'endpoint.operate',
  'endpoint.manage',
  'feature.configure',
  'feature.toggle',
]);

/** Permissions that change state; every RPC mapped to one is audited. */
export const CONSOLE_WRITE_PERMISSIONS: ReadonlySet<ConsolePermission> = new Set<ConsolePermission>([
  'endpoint.operate',
  'endpoint.manage',
  'feature.configure',
  'feature.toggle',
  'plugin.manage',
  'agent.configure',
  'ops.config.write',
  'ops.env.write',
  'ops.database.write',
  'ops.schedule.write',
  'ops.files.write',
  'ops.restart',
  'ops.terminal',
  'iam.manage',
]);

export type ConsoleBuiltinRoleName = 'owner' | 'admin' | 'operator' | 'viewer';

const viewerPermissions = CONSOLE_PERMISSION_LIST.filter(permission =>
  (permission.endsWith('.view') || permission.endsWith('.read'))
  && permission !== 'ops.config.read' && permission !== 'ops.env.read');

export const CONSOLE_BUILTIN_ROLES: Readonly<Record<ConsoleBuiltinRoleName, Readonly<{
  readonly description: string;
  readonly permissions: readonly ConsolePermission[];
}>>> = Object.freeze({
  owner: Object.freeze({ description: '所有者：全部权限', permissions: CONSOLE_PERMISSION_LIST }),
  admin: Object.freeze({
    description: '管理员：除终端与访问控制管理外的全部权限',
    permissions: Object.freeze(CONSOLE_PERMISSION_LIST.filter(p => p !== 'ops.terminal' && p !== 'iam.manage')),
  }),
  operator: Object.freeze({
    description: '运营：账号与功能日常操作',
    permissions: Object.freeze<ConsolePermission[]>([
      'status.view', 'endpoint.view', 'endpoint.operate', 'feature.view', 'feature.configure',
      'feature.toggle', 'agent.view', 'ops.schedule.read',
    ]),
  }),
  viewer: Object.freeze({
    description: '只读：查看（不含原始配置与环境变量）',
    permissions: Object.freeze(viewerPermissions),
  }),
});

export const CONSOLE_BUILTIN_ROLE_NAMES: readonly ConsoleBuiltinRoleName[] = Object.freeze(
  ['owner', 'admin', 'operator', 'viewer'] as const,
);

/** `iam.*` Console RPC (ADR 0049 §5). */
export const IAM_RPC = Object.freeze({
  USERS_LIST: 'iam.users.list',
  USERS_CREATE: 'iam.users.create',
  USERS_UPDATE: 'iam.users.update',
  USERS_DISABLE: 'iam.users.disable',
  USERS_DELETE: 'iam.users.delete',
  USERS_RESET_PASSWORD: 'iam.users.reset-password',
  ROLES_LIST: 'iam.roles.list',
  ROLES_CREATE: 'iam.roles.create',
  ROLES_UPDATE: 'iam.roles.update',
  ROLES_DELETE: 'iam.roles.delete',
  BINDINGS_SET: 'iam.bindings.set',
  TOKENS_LIST: 'iam.tokens.list',
  TOKENS_CREATE: 'iam.tokens.create',
  TOKENS_REVOKE: 'iam.tokens.revoke',
  AUDIT_LIST: 'iam.audit.list',
} as const);

/** `/auth/*` REST paths relative to the HTTP API base (ADR 0049 §5). */
export const CONSOLE_AUTH_ROUTES = Object.freeze({
  LOGIN: '/auth/login',
  LOGOUT: '/auth/logout',
  ME: '/auth/me',
  PASSWORD: '/auth/password',
  /** Self-service API tokens of the signed-in user (list / create). */
  TOKENS: '/auth/tokens',
  TOKENS_REVOKE: '/auth/tokens/revoke',
  /** Bootstrap-token only, before the first owner exists (409 afterwards). */
  SETUP: '/auth/setup',
  SETUP_DATABASE: '/auth/setup/database',
  SETUP_DATABASE_TEST: '/auth/setup/database/test',
} as const);

export type ConsoleScopeKind = 'global' | 'adapter' | 'endpoint';

/** Where a role binding applies. `adapter` key: adapter alias; `endpoint` key: `<alias>/<endpointId>`. */
export type ConsoleBindingScope =
  | Readonly<{ kind: 'global' }>
  | Readonly<{ kind: 'adapter'; key: string }>
  | Readonly<{ kind: 'endpoint'; key: string }>;

/** One effective grant: the permissions of a bound role at one scope. */
export interface ConsoleGrant {
  readonly role?: string;
  readonly scope: ConsoleBindingScope;
  readonly permissions: readonly string[];
}

/**
 * The target an RPC acts on, as far as its payload says.
 * - `global`: needs a global binding.
 * - `any`: a listing that a caller with the permission at any scope may call (results are filtered).
 */
export type ConsoleScopeTarget =
  | Readonly<{ kind: 'global' }>
  | Readonly<{ kind: 'any' }>
  | Readonly<{ kind: 'adapter'; adapter: string }>
  | Readonly<{ kind: 'endpoint'; adapter: string; endpoint: string }>;

const GLOBAL_TARGET: ConsoleScopeTarget = Object.freeze({ kind: 'global' });
const ANY_TARGET: ConsoleScopeTarget = Object.freeze({ kind: 'any' });

const P = CONSOLE_PERMISSIONS;

/**
 * Every built-in Console RPC type → required permission. Types missing here are denied to
 * every non-root principal. Plugin RPC (`plugin.<id>.<method>`) is resolved by
 * {@link resolveConsoleRpcPermission}.
 */
export const CONSOLE_RPC_PERMISSIONS: Readonly<Record<string, ConsolePermission>> = Object.freeze({
  // Shell
  'ping': P.STATUS_VIEW,
  'entries:get': P.STATUS_VIEW,
  'pages:list': P.STATUS_VIEW,
  // Raw configuration (CONFIG_RPC)
  'config:get': P.OPS_CONFIG_READ,
  'config:get-all': P.OPS_CONFIG_READ,
  'config:get-source': P.OPS_CONFIG_READ,
  'config:get-project': P.OPS_CONFIG_READ,
  'config:explain': P.OPS_CONFIG_READ,
  'config:replace-source': P.OPS_CONFIG_WRITE,
  'config:set': P.OPS_CONFIG_WRITE,
  // Refined by payload in resolveConsoleRpcPermission.
  'config:patch': P.OPS_CONFIG_WRITE,
  'config:patch-project': P.OPS_CONFIG_WRITE,
  'config:apply': P.OPS_CONFIG_WRITE,
  // Schemas
  'schema:get': P.FEATURE_VIEW,
  'schema:get-all': P.FEATURE_VIEW,
  // Plugin management (PLUGIN_RPC)
  'plugin:inspect': P.FEATURE_VIEW,
  'plugin:plan-install': P.FEATURE_VIEW,
  'plugin:plan-uninstall': P.FEATURE_VIEW,
  'plugin:plan-update': P.FEATURE_VIEW,
  'plugin:plan-verification': P.FEATURE_VIEW,
  'plugin:validate-config': P.FEATURE_VIEW,
  'plugin:diagnose': P.FEATURE_VIEW,
  'plugin:apply': P.PLUGIN_MANAGE,
  'plugin:verify': P.PLUGIN_MANAGE,
  'plugin:install': P.PLUGIN_MANAGE,
  'plugin:uninstall': P.PLUGIN_MANAGE,
  'plugin:update': P.PLUGIN_MANAGE,
  'plugin:set-enabled': P.FEATURE_TOGGLE,
  // Layered feature configuration (ADR 0050 §8)
  ...FEATURE_RPC_PERMISSIONS,
  // Project files / environment / database / process
  'files:tree': P.OPS_FILES_READ,
  'files:read': P.OPS_FILES_READ,
  'files:save': P.OPS_FILES_WRITE,
  'env:list': P.OPS_ENV_READ,
  'env:get': P.OPS_ENV_READ,
  'env:save': P.OPS_ENV_WRITE,
  'db:info': P.OPS_DATABASE_READ,
  'db:tables': P.OPS_DATABASE_READ,
  'db:select': P.OPS_DATABASE_READ,
  'db:kv:get': P.OPS_DATABASE_READ,
  'db:kv:entries': P.OPS_DATABASE_READ,
  'db:insert': P.OPS_DATABASE_WRITE,
  'db:update': P.OPS_DATABASE_WRITE,
  'db:delete': P.OPS_DATABASE_WRITE,
  'db:drop-table': P.OPS_DATABASE_WRITE,
  'db:kv:set': P.OPS_DATABASE_WRITE,
  'db:kv:delete': P.OPS_DATABASE_WRITE,
  'system:restart': P.OPS_RESTART,
  // Schedules
  'schedule:list': P.OPS_SCHEDULE_READ,
  'cron:list': P.OPS_SCHEDULE_READ,
  'cron:validate': P.OPS_SCHEDULE_READ,
  'schedule:add': P.OPS_SCHEDULE_WRITE,
  'schedule:remove': P.OPS_SCHEDULE_WRITE,
  'schedule:pause': P.OPS_SCHEDULE_WRITE,
  'schedule:resume': P.OPS_SCHEDULE_WRITE,
  'cron:add': P.OPS_SCHEDULE_WRITE,
  'cron:remove': P.OPS_SCHEDULE_WRITE,
  'cron:pause': P.OPS_SCHEDULE_WRITE,
  'cron:resume': P.OPS_SCHEDULE_WRITE,
  // Endpoints (ENDPOINT_RPC)
  'endpoint.list': P.ENDPOINT_VIEW,
  'endpoint.info': P.ENDPOINT_VIEW,
  'endpoint.test': P.ENDPOINT_VIEW,
  'endpoint.friends': P.ENDPOINT_VIEW,
  'endpoint.groups': P.ENDPOINT_VIEW,
  'endpoint.channels': P.ENDPOINT_VIEW,
  'endpoint.group_members': P.ENDPOINT_VIEW,
  'endpoint.send_message': P.ENDPOINT_OPERATE,
  'endpoint.delete_friend': P.ENDPOINT_OPERATE,
  'endpoint.group_kick': P.ENDPOINT_OPERATE,
  'endpoint.group_mute': P.ENDPOINT_OPERATE,
  'endpoint.group_admin': P.ENDPOINT_OPERATE,
  // Requests / notices / inbox (SIDE_EVENT_RPC, INBOX_RPC)
  'request.list': P.ENDPOINT_VIEW,
  'inbox.messages': P.ENDPOINT_VIEW,
  'inbox.requests': P.ENDPOINT_VIEW,
  'inbox.notices': P.ENDPOINT_VIEW,
  'inbox.recent': P.ENDPOINT_VIEW,
  'request.approve': P.ENDPOINT_OPERATE,
  'request.reject': P.ENDPOINT_OPERATE,
  'request.consumed': P.ENDPOINT_OPERATE,
  'notice.consumed': P.ENDPOINT_OPERATE,
  // Login assist (LOGIN_RPC)
  'login.list': P.ENDPOINT_VIEW,
  'login.submit': P.ENDPOINT_OPERATE,
  'login.cancel': P.ENDPOINT_OPERATE,
  // Agent / Workroom
  'workrooms:get': P.AGENT_VIEW,
  'workrooms:set': P.AGENT_CONFIGURE,
  'workroom.profile.status': P.AGENT_VIEW,
  'workroom.knowledge.get': P.AGENT_VIEW,
  'workroom.profile.bootstrap': P.AGENT_CONFIGURE,
  'workroom.profile.pack.publish': P.AGENT_CONFIGURE,
  'workroom.profile.publish': P.AGENT_CONFIGURE,
  'workroom.profile.rollback': P.AGENT_CONFIGURE,
  'workroom.profile.policy.publish': P.AGENT_CONFIGURE,
  'workroom.knowledge.publish': P.AGENT_CONFIGURE,
  'workroom.knowledge.rollback': P.AGENT_CONFIGURE,
  // AGENT_COLLABORATION_RPC
  'agent.engagements.list': P.AGENT_VIEW,
  'agent.engagements.get': P.AGENT_VIEW,
  'agent.venues.list': P.AGENT_VIEW,
  // Access control (IAM_RPC)
  'iam.users.list': P.IAM_VIEW,
  'iam.roles.list': P.IAM_VIEW,
  'iam.tokens.list': P.IAM_VIEW,
  'iam.audit.list': P.IAM_VIEW,
  'iam.users.create': P.IAM_MANAGE,
  'iam.users.update': P.IAM_MANAGE,
  'iam.users.disable': P.IAM_MANAGE,
  'iam.users.delete': P.IAM_MANAGE,
  'iam.users.reset-password': P.IAM_MANAGE,
  'iam.roles.create': P.IAM_MANAGE,
  'iam.roles.update': P.IAM_MANAGE,
  'iam.roles.delete': P.IAM_MANAGE,
  'iam.bindings.set': P.IAM_MANAGE,
  'iam.tokens.create': P.IAM_MANAGE,
  'iam.tokens.revoke': P.IAM_MANAGE,
  // Terminal (ADR 0051): session open is a WebSocket; listed so the Console can gate the page.
  'terminal.open': P.OPS_TERMINAL,
});

/** Adapter account mutations contributed by `defineAdapterConsoleRpc` (`plugin.<id>.endpoint-*`). */
const ADAPTER_ACCOUNT_METHODS: ReadonlySet<string> = new Set([
  'endpoint-add', 'endpoint-update', 'endpoint-start', 'endpoint-stop', 'endpoint-remove', 'endpoint-replace',
]);

const pluginRpcPattern = /^plugin\.(root(?:\/[a-z0-9][a-z0-9-]*)*)\.([a-zA-Z][a-zA-Z0-9.-]{0,79})$/u;

export type ConsoleRpcPermissionRule =
  /** Exactly one permission. */
  | Readonly<{ kind: 'exact'; permission: ConsolePermission; target: ConsoleScopeTarget }>
  /**
   * Plugin-contributed RPC: `read` admits the call, `write` is required unless the
   * plugin declares the method read-only (decided by the plugin RPC dispatcher).
   */
  | Readonly<{ kind: 'plugin'; read: ConsolePermission; write: ConsolePermission; target: ConsoleScopeTarget }>;

/**
 * Required permission and scope target of one Console RPC, or `null` when the type is not
 * registered (deny for every non-root principal).
 */
export function resolveConsoleRpcPermission(type: unknown, message?: unknown): ConsoleRpcPermissionRule | null {
  if (typeof type !== 'string' || !type || type.length > 640) return null;
  const payload = rpcPayloads(message);
  if (Object.hasOwn(CONSOLE_RPC_PERMISSIONS, type)) {
    let permission = CONSOLE_RPC_PERMISSIONS[type]!;
    if (type === 'config:patch') {
      // Without instanceKey the Host allowlist only reaches AI/Ambient paths; with one it is plugin config.
      const instanceKey = firstString(payload, 'instanceKey');
      permission = instanceKey ? P.FEATURE_CONFIGURE : P.AGENT_CONFIGURE;
    }
    if (type === 'files:read' || type === 'files:save') {
      // The file manager also reaches dotenv and config files: they keep their own (secret) permission.
      const write = type === 'files:save';
      const file = projectFileKind(payload);
      if (file === 'env') permission = write ? P.OPS_ENV_WRITE : P.OPS_ENV_READ;
      if (file === 'config') permission = write ? P.OPS_CONFIG_WRITE : P.OPS_CONFIG_READ;
    }
    return Object.freeze({ kind: 'exact', permission, target: rpcTarget(type, permission, payload) });
  }
  const plugin = pluginRpcPattern.exec(type);
  if (!plugin) return null;
  const pluginId = plugin[1]!;
  const method = plugin[2]!.replace(/^action\./u, '');
  if (ADAPTER_ACCOUNT_METHODS.has(method)) {
    const alias = pluginAlias(pluginId);
    const id = firstString(payload, 'id');
    const target: ConsoleScopeTarget = !alias
      ? GLOBAL_TARGET
      : id && method !== 'endpoint-add' && method !== 'endpoint-replace'
        ? Object.freeze({ kind: 'endpoint', adapter: alias, endpoint: id })
        : Object.freeze({ kind: 'adapter', adapter: alias });
    return Object.freeze({ kind: 'exact', permission: P.ENDPOINT_MANAGE, target });
  }
  return Object.freeze({ kind: 'plugin', read: P.FEATURE_VIEW, write: P.FEATURE_CONFIGURE, target: GLOBAL_TARGET });
}

/** Static form of {@link resolveConsoleRpcPermission} without a payload. */
export function consoleRpcPermission(type: unknown): ConsolePermission | null {
  const rule = resolveConsoleRpcPermission(type);
  if (!rule) return null;
  return rule.kind === 'exact' ? rule.permission : rule.read;
}

export interface ConsoleHttpPermissionRule {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | '*';
  /** Path relative to the API base. `prefix` also matches sub-paths. */
  readonly path: string;
  readonly prefix?: boolean;
  /**
   * `rpc`: the route carries Console RPC envelopes and is checked per message type.
   * `authenticated`: any signed-in user or API token (its handler decides further).
   * `bootstrap`: only the bootstrap token (or an open local Host) before setup.
   * `public`: no credential.
   */
  readonly permission: ConsolePermission | 'rpc' | 'authenticated' | 'bootstrap' | 'public';
}

const httpRule = (
  method: ConsoleHttpPermissionRule['method'],
  path: string,
  permission: ConsoleHttpPermissionRule['permission'],
  prefix = false,
): ConsoleHttpPermissionRule => Object.freeze({ method, path, permission, ...(prefix ? { prefix } : {}) });

/** Every Console `/api` route → required permission (paths relative to the API base). */
export const CONSOLE_HTTP_PERMISSIONS: readonly ConsoleHttpPermissionRule[] = Object.freeze([
  httpRule('POST', '/console/request', 'rpc'),
  httpRule('POST', '/auth/login', 'public'),
  httpRule('GET', '/auth/setup', 'bootstrap'),
  httpRule('POST', '/auth/setup', 'bootstrap'),
  httpRule('GET', '/auth/setup/database', 'bootstrap'),
  httpRule('POST', '/auth/setup/database', 'bootstrap'),
  httpRule('POST', '/auth/setup/database/test', 'bootstrap'),
  httpRule('POST', '/auth/logout', 'authenticated'),
  // Public so a signed-out Console can read `setupRequired`; the handler reports the caller.
  httpRule('GET', '/auth/me', 'public'),
  httpRule('POST', '/auth/password', 'authenticated'),
  httpRule('GET', '/auth/tokens', 'authenticated'),
  httpRule('POST', '/auth/tokens', 'authenticated'),
  httpRule('POST', '/auth/tokens/revoke', 'authenticated'),
  httpRule('GET', '/system/status', P.STATUS_VIEW),
  httpRule('GET', '/system/readiness', P.STATUS_VIEW),
  httpRule('GET', '/stats', P.STATUS_VIEW),
  httpRule('GET', '/events', P.STATUS_VIEW),
  httpRule('GET', '/events/history', P.STATUS_VIEW),
  httpRule('GET', '/logs', P.STATUS_VIEW),
  httpRule('GET', '/logs/stats', P.STATUS_VIEW),
  httpRule('DELETE', '/logs', P.OPS_DATABASE_WRITE),
  httpRule('POST', '/logs/cleanup', P.OPS_DATABASE_WRITE),
  httpRule('GET', '/messages/diagnostics', P.STATUS_VIEW),
  httpRule('GET', '/introspection', P.STATUS_VIEW, true),
  httpRule('POST', '/introspection/components/render', P.STATUS_VIEW),
  httpRule('GET', '/commands/permissions', P.STATUS_VIEW),
  httpRule('POST', '/commands/permissions/explain', P.STATUS_VIEW),
  httpRule('GET', '/marketplace/updates', P.FEATURE_VIEW),
  httpRule('GET', '/plugins', P.FEATURE_VIEW, true),
  httpRule('GET', '/tasks/providers', P.FEATURE_VIEW),
  httpRule('GET', '/tasks/use-cases', P.FEATURE_VIEW),
  httpRule('POST', '/tasks/create', P.FEATURE_CONFIGURE),
  httpRule('POST', '/tasks/change', P.FEATURE_CONFIGURE),
  httpRule('GET', '/conversations/history', P.ENDPOINT_VIEW),
  httpRule('GET', '/conversations/results', P.ENDPOINT_VIEW),
  httpRule('GET', '/conversations/workspaces', P.ENDPOINT_VIEW),
  httpRule('PUT', '/conversations/workspaces', P.ENDPOINT_OPERATE),
  httpRule('GET', '/interactions/pending', P.ENDPOINT_VIEW),
  httpRule('POST', '/message/send', P.ENDPOINT_OPERATE),
  httpRule('GET', '/data-migrations', P.OPS_DATABASE_READ),
  httpRule('POST', '/data-migrations/commands', P.OPS_DATABASE_WRITE),
  httpRule('GET', '/agent/sessions', P.AGENT_VIEW, true),
  httpRule('POST', '/agent/sessions', P.AGENT_CONFIGURE, true),
  httpRule('GET', '/agent/engagements', P.AGENT_VIEW, true),
  httpRule('GET', '/agent/venues', P.AGENT_VIEW),
  httpRule('GET', '/agent/traces', P.AGENT_VIEW),
  httpRule('GET', '/agent/trace-archive', P.AGENT_VIEW, true),
  httpRule('POST', '/agent/tasks/cancel', P.AGENT_CONFIGURE),
  httpRule('GET', '/agent/inference', P.AGENT_VIEW, true),
  httpRule('*', '/agent/inference', P.AGENT_CONFIGURE, true),
  httpRule('GET', '/assistant/jobs', P.OPS_SCHEDULE_READ),
  httpRule('POST', '/assistant/jobs', P.OPS_SCHEDULE_WRITE, true),
  httpRule('POST', '/assistant/events', P.AGENT_CONFIGURE),
  httpRule('GET', '/assistant/execution', P.OPS_SCHEDULE_READ),
  httpRule('GET', '/assistant/executions', P.OPS_SCHEDULE_READ),
  httpRule('POST', '/assistant/executions/cleanup', P.OPS_SCHEDULE_WRITE),
]);

/**
 * Permission rule for one HTTP request under the API base; `null` = unmapped (deny).
 * `relativePath` excludes the API base and has no trailing slash.
 */
export function resolveConsoleHttpPermission(method: string, relativePath: string): ConsoleHttpPermissionRule | null {
  const verb = method.toUpperCase();
  let best: ConsoleHttpPermissionRule | null = null;
  let bestScore = -1;
  for (const rule of CONSOLE_HTTP_PERMISSIONS) {
    if (rule.method !== '*' && rule.method !== verb) continue;
    const matches = rule.path === relativePath
      || (rule.prefix === true && relativePath.startsWith(`${rule.path}/`));
    if (!matches) continue;
    // Longer paths win; an exact method beats the wildcard at the same length.
    const score = rule.path.length * 2 + (rule.method === '*' ? 0 : 1) + (rule.path === relativePath ? 1 : 0);
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/** WebSocket upgrade paths a non-root principal may open, and what they require. */
export const CONSOLE_WS_PERMISSIONS: Readonly<Record<string, ConsolePermission>> = Object.freeze({
  '/sandbox': P.ENDPOINT_OPERATE,
});

/** Whether a grant at `scope` covers `target` for `permission`. */
export function bindingScopeCovers(
  scope: ConsoleBindingScope,
  permission: string,
  target: ConsoleScopeTarget,
): boolean {
  if (scope.kind === 'global') return true;
  if (!CONSOLE_SCOPED_PERMISSIONS.has(permission as ConsolePermission)) return false;
  if (target.kind === 'any') return true;
  if (target.kind === 'global') return false;
  if (scope.kind === 'adapter') return target.adapter === scope.key;
  return target.kind === 'endpoint' && scope.key === `${target.adapter}/${target.endpoint}`;
}

/** Whether any grant holds `permission` for `target`. */
export function grantsAllow(
  grants: readonly ConsoleGrant[],
  permission: string,
  target: ConsoleScopeTarget = GLOBAL_TARGET,
): boolean {
  return grants.some(grant => grant.permissions.includes(permission)
    && bindingScopeCovers(grant.scope, permission, target));
}

/** Parses `global` / `adapter:<alias>` / `endpoint:<alias>/<id>` style scope input. */
export function parseConsoleBindingScope(kind: unknown, key: unknown): ConsoleBindingScope | null {
  if (kind === 'global' || kind === undefined || kind === null) {
    return key === undefined || key === null || key === '' ? Object.freeze({ kind: 'global' }) : null;
  }
  if (typeof key !== 'string' || !key || key.length > 256 || key.trim() !== key) return null;
  if (kind === 'adapter') return key.includes('/') ? null : Object.freeze({ kind: 'adapter', key });
  if (kind === 'endpoint') {
    const slash = key.indexOf('/');
    return slash > 0 && slash < key.length - 1 ? Object.freeze({ kind: 'endpoint', key }) : null;
  }
  return null;
}

function rpcPayloads(message: unknown): readonly Record<string, unknown>[] {
  if (!isRecord(message)) return [];
  const data = isRecord(message.data) ? message.data : undefined;
  return data ? [data, message] : [message];
}

/** First non-empty string at `key`; `null` when sources disagree or none has one. */
function firstString(payloads: readonly Record<string, unknown>[], key: string): string | null {
  let found: string | null = null;
  for (const payload of payloads) {
    const value = payload[key];
    if (typeof value !== 'string' || !value.trim()) continue;
    if (found !== null && found !== value.trim()) return null;
    found = value.trim();
  }
  return found;
}

function hasConflict(payloads: readonly Record<string, unknown>[], key: string): boolean {
  const values = new Set(payloads.map(payload => payload[key]).filter(value => typeof value === 'string' && value.trim())
    .map(value => (value as string).trim()));
  return values.size > 1;
}

const listAllTypes: ReadonlySet<string> = new Set(['endpoint.list']);

function rpcTarget(type: string, permission: ConsolePermission, payloads: readonly Record<string, unknown>[]): ConsoleScopeTarget {
  if (!CONSOLE_SCOPED_PERMISSIONS.has(permission)) return GLOBAL_TARGET;
  if (type.startsWith('feature.')) {
    const level = firstString(payloads, 'level');
    const key = firstString(payloads, 'key');
    if (hasConflict(payloads, 'level') || hasConflict(payloads, 'key')) return GLOBAL_TARGET;
    if (level === 'adapter' && key && !key.includes('/')) return Object.freeze({ kind: 'adapter', adapter: key });
    if (level === 'endpoint' && key) {
      const slash = key.indexOf('/');
      if (slash > 0 && slash < key.length - 1) {
        return Object.freeze({ kind: 'endpoint', adapter: key.slice(0, slash), endpoint: key.slice(slash + 1) });
      }
    }
    return GLOBAL_TARGET;
  }
  if (type.startsWith('plugin:')) return GLOBAL_TARGET;
  if (listAllTypes.has(type)) return ANY_TARGET;
  if (hasConflict(payloads, 'adapter') || hasConflict(payloads, 'endpointKey')) return GLOBAL_TARGET;
  const adapter = firstString(payloads, 'adapter');
  const endpoint = firstString(payloads, 'endpointKey');
  if (adapter && endpoint) return Object.freeze({ kind: 'endpoint', adapter, endpoint });
  // Payloads naming only an adapter, or none, can reach every account: global only.
  return GLOBAL_TARGET;
}

/** `env` / `config` when an RPC names a dotenv or root config file; ambiguous input counts as `env`. */
function projectFileKind(payloads: readonly Record<string, unknown>[]): 'env' | 'config' | 'other' {
  if (hasConflict(payloads, 'filePath')) return 'env';
  // Handlers stringify the field: anything but a plain string could still name a dotenv file.
  if (payloads.some(payload => payload.filePath !== undefined && typeof payload.filePath !== 'string')) return 'env';
  const path = firstString(payloads, 'filePath');
  if (!path) return 'other';
  const base = path.replace(/\\/gu, '/').split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
  if (base === '.env' || base.startsWith('.env.')) return 'env';
  if (/^(?:zhin\.)?config\.(?:ya?ml|json)$/u.test(base)) return 'config';
  return 'other';
}

function pluginAlias(pluginId: string): string | null {
  const parts = pluginId.split('/');
  return parts.length === 2 && parts[0] === 'root' ? parts[1]! : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
