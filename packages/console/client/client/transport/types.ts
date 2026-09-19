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

export class ConsoleTransportError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "ConsoleTransportError";
  }
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
