import {
  createGenerationAdmissionGate,
  generationAdmissionSource,
  type GenerationAdmissionGate,
  type GenerationAdmissionSource,
} from './admission.js';
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
 * satisfy that page's `requiredPermissions` / `requiredRoles`. Actions always require the
 * full-scope Console token; `status` is readable with the demo token only when it opts in
 * with `demo: true` and its page has no requirements.
 */

export type PluginConsoleRpcJson = JsonValue;
export type PluginConsoleRpcInput = Readonly<Record<string, JsonValue>>;

export interface PluginConsoleRpcCall {
  /** Aborted when the Host request times out. Long work must observe it. */
  readonly signal: AbortSignal;
}

export interface PluginConsoleRpcMethod<TInput = PluginConsoleRpcInput> {
  /** Local name of a Page owned by the same plugin (`pages/<page>/index.tsx`). Its access rules apply. */
  readonly page?: string;
  /** Extra permissions on top of the page's own requirements. */
  readonly requiredPermissions?: readonly string[];
  /** Extra roles on top of the page's own requirements. */
  readonly requiredRoles?: readonly string[];
  /**
   * Return a small, user-facing JSON shape. Never return raw log records, prompts, chat lines,
   * secrets or exception text: the Console shows this to ordinary users.
   */
  handler(input: TInput, call: PluginConsoleRpcCall): JsonValue | Promise<JsonValue>;
}

export interface PluginConsoleRpcStatus extends PluginConsoleRpcMethod<PluginConsoleRpcInput> {
  /** Allow the demo-scope Console token to read this status. Default `false`. */
  readonly demo?: boolean;
}

export interface PluginConsoleRpcDefinition {
  /** Read-only status for the plugin's Console page(s): `plugin.<pluginId>.status`. */
  readonly status?: PluginConsoleRpcStatus;
  /** Limited, named actions: `plugin.<pluginId>.<name>`. Always full scope. */
  readonly actions?: Readonly<Record<string, PluginConsoleRpcMethod>>;
}

export interface NormalizedPluginConsoleRpcMethod {
  readonly page?: string;
  readonly requiredPermissions: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly demo: boolean;
  readonly handler: PluginConsoleRpcMethod['handler'];
}

/** Value published under {@link pluginConsoleRpcToken}; create it with {@link definePluginConsoleRpc}. */
export interface PluginConsoleRpc extends GenerationAdmissionSource {
  readonly methods: ReadonlyMap<string, NormalizedPluginConsoleRpcMethod>;
}

/** Safe, user-facing failure. `message` is shown in the Console; never put raw errors in it. */
export class PluginConsoleRpcError extends Error {
  readonly code: 'invalid_input' | 'conflict' | 'not_found' | 'unsupported' | 'unavailable';
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
export function definePluginConsoleRpc(definition: PluginConsoleRpcDefinition): PluginConsoleRpc {
  if (!definition || typeof definition !== 'object') throw new TypeError('Plugin Console RPC definition must be an object');
  const methods = new Map<string, NormalizedPluginConsoleRpcMethod>();
  if (definition.status !== undefined) {
    methods.set(PLUGIN_CONSOLE_RPC_STATUS, normalizeMethod('status', definition.status, definition.status.demo === true));
  }
  for (const [name, method] of Object.entries(definition.actions ?? {})) {
    if (!methodNamePattern.test(name)) throw new TypeError(`Invalid plugin Console RPC action name: ${name}`);
    if (name === PLUGIN_CONSOLE_RPC_STATUS) throw new TypeError('"status" is reserved; declare it as definition.status');
    methods.set(name, normalizeMethod(name, method, false));
  }
  if (methods.size === 0) throw new TypeError('Plugin Console RPC must declare status or at least one action');
  const gate: GenerationAdmissionGate = createGenerationAdmissionGate();
  const gates = Object.freeze([gate]);
  return Object.freeze({
    methods: methods as ReadonlyMap<string, NormalizedPluginConsoleRpcMethod>,
    get [generationAdmissionSource]() { return gates; },
  });
}

function normalizeMethod(name: string, method: PluginConsoleRpcMethod, demo: boolean): NormalizedPluginConsoleRpcMethod {
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
    demo,
    handler: method.handler as PluginConsoleRpcMethod['handler'],
  });
}

function stringList(value: unknown, label: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) {
    throw new TypeError(`Plugin Console RPC ${label} must be non-empty strings`);
  }
  return Object.freeze([...new Set(value as string[])].sort());
}
