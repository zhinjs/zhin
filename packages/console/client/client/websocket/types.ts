export interface BaseMessage {
  type: string;
  timestamp?: number;
  requestId?: number;
  error?: string;
}

export type WebSocketMessage = BaseMessage & { data?: unknown; [key: string]: unknown };

export interface WebSocketConfig {
  url?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  requestTimeout?: number;
}

export interface WebSocketCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  onMessage?: (message: WebSocketMessage) => void;
}

export interface UseWebSocketOptions {
  autoConnect?: boolean;
}

export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  ERROR = "error",
}

export class WebSocketError extends Error {
  constructor(
    message: string,
    public code: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = "WebSocketError";
  }
}

export class RequestTimeoutError extends WebSocketError {
  constructor(requestId: number) {
    super(`Request ${requestId} timed out`, "REQUEST_TIMEOUT");
  }
}

export class ConnectionError extends WebSocketError {
  constructor(message: string, originalError?: Error) {
    super(message, "CONNECTION_ERROR", originalError);
  }
}

export class MessageError extends WebSocketError {
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
