import {
  createGenerationAdmissionGate,
  generationAdmissionSource,
  type GenerationAdmissionGate,
  type GenerationAdmissionSource,
} from './admission.js';
import type { PluginId, FeatureId } from './identity.js';
import type { JsonValue } from './persistent-state.js';
import { createToken } from './token.js';

/**
 * Plugin-registered Console RPC (zhinjs/zhin#970).
 *
 * A plugin publishes one {@link PluginConsoleRpc} through {@link pluginConsoleRpcToken}. The Host
 * exposes it on the existing Console RPC envelope as `plugin.<pluginId>.status` and
 * `plugin.<pluginId>.<action>`, where `<pluginId>` is the owner PluginId (for example
 * `root/typesafe`). No WebSocket, no new HTTP route, and no generic config writes.
 *
 * Authorization follows the Console Page the method is bound to (`page`): the caller must
 * satisfy that page's `requiredPermissions` / `requiredRoles`, plus the method's own. The full
 * (admin) token may call everything. Other tokens (`user` / `demo`) may call a method when they
 * hold every required permission and role. An action is open to them only when it declares its
 * own `requiredPermissions` / `requiredRoles` / `anyOfPermissions` (the page's requirements apply on
 * top, but never grant an action by themselves); an unguarded `status` needs `demo: true`.
 * `anyOfPermissions` is satisfied by holding at least one of the listed permissions (for a new
 * permission that coexists with an older one, e.g. `ops:approve` beside `tool_approvals:resolve`).
 */

export type PluginConsoleRpcJson = JsonValue;
export type PluginConsoleRpcInput = Readonly<Record<string, JsonValue>>;

export interface PluginConsoleRpcCall<TConfig = Record<string, unknown>> {
  /** Aborted when the Host request times out. Long work must observe it. */
  readonly signal: AbortSignal;
  /** Validated plugin configuration for this generation, when available. */
  readonly config?: TConfig;
  /** Authenticated operation view; no snapshot, configuration, resource or private resolver access. */
  readonly runtime?: Readonly<{
    owner: PluginId; generation: number; operator: boolean;
    project(feature: FeatureId): unknown;
  }>;
  /** Framework-only request-local notification before a validated durable mutation begins. */
  commitStarted?(): void;
}

export type PluginConsoleRpcCallContext<
  TMethods = Record<string, unknown>,
  TKey extends keyof TMethods = keyof TMethods,
  TConfig = Record<string, unknown>,
> = PluginConsoleRpcCall<TConfig> & {
  readonly method?: TKey;
};

export interface PluginConsoleRpcMethod<
  TInput = PluginConsoleRpcInput,
  TConfig = Record<string, unknown>,
> {
  /** Local name of a Page owned by the same plugin (`pages/<page>/index.tsx`). Its access rules apply. */
  readonly page?: string;
  /** Extra permissions on top of the page's own requirements. */
  readonly requiredPermissions?: readonly string[];
  /** Extra roles on top of the page's own requirements. */
  readonly requiredRoles?: readonly string[];
  /**
   * The caller must also hold at least one of these (in addition to every `requiredPermissions`).
   * Counts as the method's own requirement for actions.
   */
  readonly anyOfPermissions?: readonly string[];
  /**
   * Return a small, user-facing JSON shape. Never return raw log records, prompts, chat lines,
   * secrets or exception text: the Console shows this to ordinary users.
   */
  handler(input: TInput, call: PluginConsoleRpcCall<TConfig>): JsonValue | Promise<JsonValue>;
}

export interface PluginConsoleRpcStatus<TConfig = Record<string, unknown>>
  extends PluginConsoleRpcMethod<PluginConsoleRpcInput, TConfig> {
  /** Allow the demo-scope Console token to read this status. Default `false`. */
  readonly demo?: boolean;
}

/**
 * Level of a plugin-defined permission (ADR 0049 amendment 2026-11-11). Built-in roles grant by
 * level: viewer → read; operator → read + operate; admin and owner → all.
 */
export type PluginConsolePermissionLevel = 'read' | 'operate' | 'manage';

/** Metadata for a permission string used in this plugin's pages or Console RPC. */
export interface PluginConsolePermission {
  /** `<plugin>:<action>`, e.g. `rss:read`, `ops:approve`. */
  readonly id: string;
  readonly level: PluginConsolePermissionLevel;
  /** Short label for the Console's role editor. */
  readonly description?: string;
}

export interface PluginConsoleRpcDefinition<TConfig = Record<string, unknown>> {
  /**
   * Levels of the permissions this plugin uses (its pages' and methods' requirements). An
   * undeclared permission takes its level from the suffix: `:read` / `:view` → read;
   * `:approve` / `:manage` / `:admin` / `:write` / `:config` → manage; anything else → operate.
   */
  readonly permissions?: readonly PluginConsolePermission[];
  /** Read-only status for the plugin's Console page(s): `plugin.<pluginId>.status`. */
  readonly status?: PluginConsoleRpcStatus<TConfig>;
  /**
   * Extra read-only views beside `status`: `plugin.<pluginId>.<name>`. Same access rules as
   * `status`; use them when one plugin backs several pages with different permissions.
   */
  readonly queries?: Readonly<Record<string, PluginConsoleRpcStatus<TConfig>>>;
  /**
   * Limited, named actions: `plugin.<pluginId>.<name>`. Non-admin tokens may run one only when the
   * action declares its own requirements and the token holds them (plus the page's); otherwise
   * admin-only.
   */
  readonly actions?: Readonly<Record<string, PluginConsoleRpcMethod<PluginConsoleRpcInput, TConfig>>>;
}

export interface PluginConsoleRpcDefiner<TConfig = Record<string, unknown>> {
  (definition: PluginConsoleRpcDefinition<TConfig>): PluginConsoleRpc;
}

export interface NormalizedPluginConsoleRpcMethod {
  readonly page?: string;
  readonly requiredPermissions: readonly string[];
  readonly requiredRoles: readonly string[];
  /** Empty when the method has no either-of requirement. */
  readonly anyOfPermissions: readonly string[];
  readonly demo: boolean;
  /** `status` and `queries` are read-only; actions are not. */
  readonly readOnly: boolean;
  readonly handler: PluginConsoleRpcMethod['handler'];
}

/** Value published under {@link pluginConsoleRpcToken}; create it with {@link definePluginConsoleRpc}. */
export interface PluginConsoleRpc extends GenerationAdmissionSource {
  readonly methods: ReadonlyMap<string, NormalizedPluginConsoleRpcMethod>;
  /** Declared permission levels; absent or empty when the plugin declared none. */
  readonly permissions?: readonly PluginConsolePermission[];
}

/** Safe, user-facing failure. `message` is shown in the Console; never put raw errors in it. */
export class PluginConsoleRpcError extends Error {
  readonly code: 'invalid_input' | 'conflict' | 'not_found' | 'unsupported' | 'unavailable' | 'forbidden' | 'commit_unknown';
  constructor(code: PluginConsoleRpcError['code'], message: string) {
    super(message);
    this.name = 'PluginConsoleRpcError';
    this.code = code;
  }
}

export const pluginConsoleRpcToken = createToken<PluginConsoleRpc>(
  'zhin.plugin-console-rpc',
  'Plugin-owned Console status and limited actions, called through the authenticated Console RPC envelope',
);

export const PLUGIN_CONSOLE_RPC_STATUS = 'status';
const methodNamePattern = /^[a-z][a-z0-9-]{0,63}$/u;
const pageNamePattern = /^[a-z0-9][a-z0-9-]*$/u;

/** Validates and freezes a plugin's Console RPC surface. Throws on invalid names at setup time. */
export function definePluginConsoleRpc<TConfig = Record<string, unknown>>(
  definition: PluginConsoleRpcDefinition<TConfig>,
): PluginConsoleRpc {
  if (!definition || typeof definition !== 'object') throw new TypeError('Plugin Console RPC definition must be an object');
  const methods = new Map<string, NormalizedPluginConsoleRpcMethod>();
  if (definition.status !== undefined) {
    methods.set(
      PLUGIN_CONSOLE_RPC_STATUS,
      normalizeMethod('status', definition.status as PluginConsoleRpcMethod, definition.status.demo === true, true),
    );
  }
  for (const [kind, entries] of [['query', definition.queries], ['action', definition.actions]] as const) {
    for (const [name, method] of Object.entries(entries ?? {})) {
      if (!methodNamePattern.test(name)) throw new TypeError(`Invalid plugin Console RPC ${kind} name: ${name}`);
      if (name === PLUGIN_CONSOLE_RPC_STATUS) throw new TypeError('"status" is reserved; declare it as definition.status');
      if (methods.has(name)) throw new TypeError(`Duplicate plugin Console RPC method: ${name}`);
      const readOnly = kind === 'query';
      methods.set(
        name,
        normalizeMethod(
          name,
          method as PluginConsoleRpcMethod,
          readOnly && (method as PluginConsoleRpcStatus<TConfig>).demo === true,
          readOnly,
        ),
      );
    }
  }
  if (methods.size === 0) throw new TypeError('Plugin Console RPC must declare status or at least one action');
  const permissions = permissionDeclarations(definition.permissions);
  const gate: GenerationAdmissionGate = createGenerationAdmissionGate();
  const gates = Object.freeze([gate]);
  return Object.freeze({
    methods: methods as ReadonlyMap<string, NormalizedPluginConsoleRpcMethod>,
    ...(permissions.length ? { permissions } : {}),
    get [generationAdmissionSource]() { return gates; },
  });
}

/**
 * Fix the plugin config type first, then define the Console RPC surface:
 * `definePluginConsoleRpc.withConfig<MyConfig>()({ status: { handler(_input, call) { ... } } })`
 */
definePluginConsoleRpc.withConfig = function withConfig<
  TConfig = Record<string, unknown>,
>(): PluginConsoleRpcDefiner<TConfig> {
  return (definition: PluginConsoleRpcDefinition<TConfig>) => definePluginConsoleRpc(definition);
};

function normalizeMethod(
  name: string,
  method: PluginConsoleRpcMethod,
  demo: boolean,
  readOnly: boolean,
): NormalizedPluginConsoleRpcMethod {
  if (!method || typeof method.handler !== 'function') {
    throw new TypeError(`Plugin Console RPC ${name} must have a handler`);
  }
  if (method.page !== undefined && (typeof method.page !== 'string' || !pageNamePattern.test(method.page))) {
    throw new TypeError(`Plugin Console RPC ${name} has an invalid page name`);
  }
  return Object.freeze({
    ...(method.page === undefined ? {} : { page: method.page }),
    requiredPermissions: stringList(method.requiredPermissions, `${name} requiredPermissions`),
    requiredRoles: stringList(method.requiredRoles, `${name} requiredRoles`),
    anyOfPermissions: stringList(method.anyOfPermissions, `${name} anyOfPermissions`),
    demo,
    readOnly,
    handler: method.handler as PluginConsoleRpcMethod['handler'],
  });
}

// Same shape as `CONSOLE_PLUGIN_PERMISSION_PATTERN` in @zhin.js/console-protocol (this package has no deps).
const permissionIdPattern = /^[a-z][a-z0-9_-]{0,63}:[a-z][a-z0-9_.-]{0,63}$/u;
const permissionLevels: ReadonlySet<string> = new Set(['read', 'operate', 'manage']);

function permissionDeclarations(value: unknown): readonly PluginConsolePermission[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('Plugin Console RPC permissions must be an array');
  const seen = new Set<string>();
  return Object.freeze(value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('Plugin Console RPC permission must be an object');
    const { id, level, description, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length) throw new TypeError(`Plugin Console RPC permission has unknown keys: ${Object.keys(rest).sort().join(', ')}`);
    if (typeof id !== 'string' || !permissionIdPattern.test(id)) throw new TypeError('Plugin Console RPC permission id must look like <plugin>:<action>');
    if (seen.has(id)) throw new TypeError(`Duplicate plugin Console RPC permission: ${id}`);
    seen.add(id);
    if (typeof level !== 'string' || !permissionLevels.has(level)) throw new TypeError(`Plugin Console RPC permission ${id} level must be read, operate or manage`);
    if (description !== undefined && (typeof description !== 'string' || !description.trim() || description.length > 256)) {
      throw new TypeError(`Plugin Console RPC permission ${id} description must be a non-empty string (at most 256 characters)`);
    }
    return Object.freeze({
      id, level: level as PluginConsolePermissionLevel,
      ...(description === undefined ? {} : { description: (description as string).trim() }),
    });
  }));
}

function stringList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new TypeError(`Plugin Console RPC ${label} must be non-empty strings`);
  }
  return Object.freeze([...new Set(value as string[])].sort());
}
