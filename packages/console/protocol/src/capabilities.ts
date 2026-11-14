/**
 * Console ↔ Host capability handshake and RPC refusal vocabulary (zhinjs/zhin#1250).
 *
 * - `unknown_rpc`: the Host has no handler for the RPC type and no permission entry for it. Nothing
 *   ran and nothing else is disclosed; it is not a security refusal and is not written to the audit
 *   log. A Console that sees it stops calling that RPC for the rest of the session.
 * - Audited refusals carry `detail.reason` (one of {@link CONSOLE_DENIAL_REASONS}) so the audit log
 *   says why a request was refused.
 * - `GET {base}/console/capabilities` (any signed-in principal) tells the Console which RPC types
 *   this Host answers, so it never sends an optional RPC the Host lacks.
 *
 * This module must not import from `./index.js` (the barrel re-exports it).
 */

/** Error code of a Console RPC the Host does not have (HTTP 404). */
export const CONSOLE_UNKNOWN_RPC_CODE = 'unknown_rpc' as const;

/** Audit `detail.reason` of a refused Console request. */
export const CONSOLE_DENIAL_REASONS = Object.freeze({
  /** No valid credential was presented. */
  NOT_AUTHENTICATED: 'not_authenticated',
  /** Only the bootstrap token is valid and the first owner does not exist yet. */
  SETUP_REQUIRED: 'setup_required',
  /** The Host handles the RPC but it is missing from the permission map (a development error). */
  UNMAPPED_PERMISSION: 'unmapped_permission',
  /** The HTTP route / WebSocket path is not in the permission map. */
  UNMAPPED_ROUTE: 'unmapped_route',
  /** The principal does not hold the required permission at any scope. */
  INSUFFICIENT_PERMISSION: 'insufficient_permission',
  /** The principal holds the permission, but not at the adapter / endpoint the request names. */
  SCOPE_DENIED: 'scope_denied',
  /** The permission map admitted the request; the handler's own check refused it. */
  HANDLER_DENIED: 'handler_denied',
  /** A plugin Console RPC that no loaded plugin answers. */
  NO_PLUGIN_HANDLER: 'no_plugin_handler',
  /** A socket-only gateway RPC (`gateway.console.*` etc.) sent over HTTP. */
  SOCKET_ONLY: 'socket_only',
} as const);

export type ConsoleDenialReason = typeof CONSOLE_DENIAL_REASONS[keyof typeof CONSOLE_DENIAL_REASONS];

const DENIAL_REASON_SET: ReadonlySet<string> = new Set(Object.values(CONSOLE_DENIAL_REASONS));

export function isConsoleDenialReason(value: unknown): value is ConsoleDenialReason {
  return typeof value === 'string' && DENIAL_REASON_SET.has(value);
}

/** Path of the capability read, relative to the API base (permission `authenticated`). */
export const CONSOLE_CAPABILITIES_PATH = '/console/capabilities' as const;

/** Version of the capability reply shape. */
export const CONSOLE_CAPABILITIES_VERSION = 1 as const;

/** Feature flags a Host may advertise next to its RPC list. */
export const CONSOLE_FEATURES = Object.freeze({
  /** Unknown RPC types are answered with 404 `unknown_rpc` (not a 403 refusal). */
  UNKNOWN_RPC_CODE: 'rpc.unknown-code',
  /** Audited refusals carry `detail.reason`. */
  DENIAL_REASONS: 'audit.denial-reasons',
  /** Plugin Console RPC (`plugin.<pluginId>.<method>`) is dispatched. */
  PLUGIN_RPC: 'rpc.plugin',
  /** Management gateway RPC (`gateway.*`, `iam.*` on the gateway) is answered. */
  GATEWAY: 'gateway',
} as const);

export type ConsoleFeature = typeof CONSOLE_FEATURES[keyof typeof CONSOLE_FEATURES];

/** Reply data of `GET {base}/console/capabilities`. */
export interface ConsoleCapabilities {
  readonly version: number;
  /** Built-in RPC types the Host answers, sorted (plugin RPC is covered by `rpc.plugin`). */
  readonly rpc: readonly string[];
  /** Feature flags, sorted ({@link CONSOLE_FEATURES}; unknown flags are kept). */
  readonly features: readonly string[];
  /**
   * False when part of the Host did not answer (the gateway replied while the instance was not
   * running): RPC types missing from `rpc` may still exist. Read again later.
   */
  readonly complete: boolean;
}

const RPC_NAME = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/u;
const MAX_ENTRIES = 1024;

function names(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null;
  const out = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !RPC_NAME.test(entry)) return null;
    out.add(entry);
  }
  return [...out].sort();
}

/** Builds a frozen, sorted capability record. */
export function createConsoleCapabilities(input: {
  readonly rpc: Iterable<string>;
  readonly features?: Iterable<string>;
  readonly complete?: boolean;
}): ConsoleCapabilities {
  return Object.freeze({
    version: CONSOLE_CAPABILITIES_VERSION,
    rpc: Object.freeze([...new Set(input.rpc)].sort()),
    features: Object.freeze([...new Set(input.features ?? [])].sort()),
    complete: input.complete !== false,
  });
}

/** Parses a capability reply (the `data` of the envelope); null when it is not one. */
export function parseConsoleCapabilities(value: unknown): ConsoleCapabilities | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.version !== 'number' || !Number.isInteger(record.version) || record.version < 1) return null;
  const rpc = names(record.rpc);
  const features = names(record.features ?? []);
  if (!rpc || !features) return null;
  return createConsoleCapabilities({ rpc, features, complete: record.complete !== false });
}

/** Union of two Host parts (gateway + instance); complete only when both are. */
export function mergeConsoleCapabilities(a: ConsoleCapabilities, b: ConsoleCapabilities): ConsoleCapabilities {
  return createConsoleCapabilities({
    rpc: [...a.rpc, ...b.rpc],
    features: [...a.features, ...b.features],
    complete: a.complete && b.complete,
  });
}
