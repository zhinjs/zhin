import type { ConsoleEventDelivery } from '@zhin.js/console-protocol';

export interface BaseMessage {
  type: string;
  timestamp?: number;
  runtimeId?: string;
  eventId?: number;
  delivery?: ConsoleEventDelivery;
  requestId?: number;
  error?: string;
}

export type ConsoleTransportMessage = BaseMessage & { data?: unknown; [key: string]: unknown };

export interface ConsoleTransportConfig {
  fetch?: typeof globalThis.fetch;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  requestTimeout?: number;
  /** Timeout for gateway dependency transactions (install / update / uninstall). Default 300 s. */
  packageOperationTimeout?: number;
}

/** Per-call overrides for a Console RPC. */
export interface ConsoleRequestOptions {
  /** Overrides the transport-wide timeout for this call. */
  readonly timeoutMs?: number;
  /**
   * Console event type whose arrival renews the timeout (an idle timeout instead of a fixed one).
   * Package transactions renew on `gateway.packages.progress`.
   */
  readonly renewOn?: string;
}

export interface ConsoleTransportCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
  onMessage?: (message: ConsoleTransportMessage) => void;
}

export interface UseConsoleTransportOptions {
  autoConnect?: boolean;
}

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

/** Structured validation feedback a Host error reply may carry (e.g. `gateway.plugins.declare`). */
export interface ConsoleTransportErrorDetails {
  /** The Host's own error code (`invalid_input`, `forbidden`, …), when it sent one. */
  readonly serverCode?: string;
  readonly errors?: readonly { readonly path: string; readonly message: string }[];
  readonly missingEnv?: readonly string[];
}

export class ConsoleTransportError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error,
    public details: ConsoleTransportErrorDetails = {},
  ) {
    super(message);
    this.name = "ConsoleTransportError";
  }
}

/** Reads the structured fields of a Host error body; unknown shapes are dropped. */
export function readConsoleErrorDetails(body: unknown): ConsoleTransportErrorDetails {
  if (!body || typeof body !== 'object') return {};
  const record = body as Record<string, unknown>;
  const errors = Array.isArray(record.errors)
    ? record.errors.flatMap(item => item && typeof item === 'object'
      && typeof (item as Record<string, unknown>).path === 'string'
      && typeof (item as Record<string, unknown>).message === 'string'
      ? [{ path: (item as { path: string }).path, message: (item as { message: string }).message }]
      : [])
    : [];
  const missingEnv = Array.isArray(record.missingEnv)
    ? record.missingEnv.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    ...(typeof record.code === 'string' ? { serverCode: record.code } : {}),
    ...(errors.length ? { errors } : {}),
    ...(missingEnv.length ? { missingEnv } : {}),
  };
}

export class ConnectionError extends ConsoleTransportError {
  constructor(message: string, originalError?: Error) {
    super(message, "CONNECTION_ERROR", originalError);
  }
}

export class MessageError extends ConsoleTransportError {
  constructor(message: string, originalError?: Error) {
    super(message, "MESSAGE_ERROR", originalError);
  }
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
}

export type DatabaseType = "related" | "document" | "keyvalue";

export interface DatabaseInfo {
  dialect: string;
  type: DatabaseType;
  tables: string[];
}

export interface TableInfo {
  name: string;
  columns?: Record<string, { type: string; primary?: boolean; nullable?: boolean; default?: unknown }>;
}

export interface SelectResult {
  rows: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KvEntry {
  key: string;
  value: unknown;
}
