import type {
  WebSocketMessage,
  WebSocketConfig,
  WebSocketCallbacks,
} from "./types";
import {
  ConnectionState,
  WebSocketError,
  ConnectionError,
  MessageError,
  RequestTimeoutError,
} from "./types";

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private callbacks: WebSocketCallbacks;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private connectedListeners = new Set<(connected: boolean) => void>();

  constructor(config: WebSocketConfig = {}, callbacks: WebSocketCallbacks = {}) {
    this.config = {
      url: this.buildWebSocketUrl(config.url),
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      requestTimeout: config.requestTimeout ?? 10000,
    };
    this.callbacks = callbacks;
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  private notifyConnection(connected: boolean) {
    for (const l of this.connectedListeners) l(connected);
  }

  connect(): void {
    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) return;
    this.setState(ConnectionState.CONNECTING);
    try {
      this.ws = new WebSocket(this.config.url);
      this.attachEventHandlers();
    } catch (error) {
      this.handleConnectionError(new ConnectionError("Failed to create WebSocket", error as Error));
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();
    this.clearPendingRequests();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState(ConnectionState.DISCONNECTED);
    this.notifyConnection(false);
  }

  send(message: unknown): void {
    if (!this.isConnected()) throw new WebSocketError("WebSocket is not connected", "NOT_CONNECTED");
    try {
      this.ws!.send(JSON.stringify(message));
    } catch (error) {
      throw new MessageError("Failed to send message", error as Error);
    }
  }

  async sendRequest<T = unknown>(message: unknown): Promise<T> {
    if (!this.isConnected()) throw new WebSocketError("WebSocket is not connected", "NOT_CONNECTED");
    return new Promise((resolve, reject) => {
      const requestId = ++this.requestId;
      const messageWithId = { ...(message as Record<string, unknown>), requestId };
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new RequestTimeoutError(requestId));
      }, this.config.requestTimeout);
      this.pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
      try {
        this.ws!.send(JSON.stringify(messageWithId));
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timer);
        reject(new MessageError("Failed to send request", error as Error));
      }
    });
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  getState(): ConnectionState {
    return this.state;
  }

  async getConfig(pluginName: string) {
    return this.sendRequest<unknown>({ type: "config:get", pluginName });
  }
  async setConfig(pluginName: string, config: unknown) {
    return this.sendRequest<{ success?: boolean; reloaded?: boolean; message?: string }>({ type: "config:set", pluginName, data: config });
  }
  async getSchema(pluginName: string) {
    return this.sendRequest<unknown>({ type: "schema:get", pluginName });
  }
  async getAllConfigs() {
    return this.sendRequest<Record<string, unknown>>({ type: "config:get-all" });
  }
  async getAllSchemas() {
    return this.sendRequest<Record<string, unknown>>({ type: "schema:get-all" });
  }
  async getConfigYaml() {
    return this.sendRequest<{ yaml: string; pluginKeys: string[] }>({ type: "config:get-yaml" });
  }
  async saveConfigYaml(yaml: string) {
    return this.sendRequest<{ success: boolean; message?: string }>({ type: "config:save-yaml", yaml });
  }
  async getEnvList() {
    return this.sendRequest<{ files: Array<{ name: string; exists: boolean }> }>({ type: "env:list" });
  }
  async getEnvFile(filename: string) {
    return this.sendRequest<{ content: string }>({ type: "env:get", filename });
  }
  async saveEnvFile(filename: string, content: string) {
    return this.sendRequest<{ success: boolean; message?: string }>({ type: "env:save", filename, content });
  }
  async getFileTree() {
    return this.sendRequest<{ tree: import("./types").FileTreeNode[] }>({ type: "files:tree" });
  }
  async readFile(filePath: string) {
    return this.sendRequest<{ content: string; size: number }>({ type: "files:read", filePath });
  }
  async saveFile(filePath: string, content: string) {
    return this.sendRequest<{ success: boolean; message?: string }>({ type: "files:save", filePath, content });
  }
  async getDbInfo() {
    return this.sendRequest<import("./types").DatabaseInfo>({ type: "db:info" });
  }
  async getDbTables() {
    return this.sendRequest<{ tables: import("./types").TableInfo[] }>({ type: "db:tables" });
  }
  async dbSelect(table: string, page?: number, pageSize?: number, where?: unknown) {
    return this.sendRequest<import("./types").SelectResult>({ type: "db:select", table, page, pageSize, where });
  }
  async dbInsert(table: string, row: unknown) {
    return this.sendRequest<{ success: boolean }>({ type: "db:insert", table, row });
  }
  async dbUpdate(table: string, row: unknown, where: unknown) {
    return this.sendRequest<{ success: boolean; affected: number }>({ type: "db:update", table, row, where });
  }
  async dbDelete(table: string, where: unknown) {
    return this.sendRequest<{ success: boolean; deleted: number }>({ type: "db:delete", table, where });
  }
  async dbDropTable(table: string) {
    return this.sendRequest<{ success: boolean }>({ type: "db:drop-table", table });
  }
  async kvGet(table: string, key: string) {
    return this.sendRequest<{ key: string; value: unknown }>({ type: "db:kv:get", table, key });
  }
  async kvSet(table: string, key: string, value: unknown, ttl?: number) {
    return this.sendRequest<{ success: boolean }>({ type: "db:kv:set", table, key, value, ttl });
  }
  async kvDelete(table: string, key: string) {
    return this.sendRequest<{ success: boolean }>({ type: "db:kv:delete", table, key });
  }
  async kvGetEntries(table: string) {
    return this.sendRequest<{ entries: import("./types").KvEntry[] }>({ type: "db:kv:entries", table });
  }

  private buildWebSocketUrl(customUrl?: string): string {
    if (customUrl) return customUrl;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/server`;
  }

  private setState(newState: ConnectionState): void {
    this.state = newState;
  }

  private attachEventHandlers(): void {
    if (!this.ws) return;
    this.ws.onopen = () => this.handleConnectionOpen();
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = () => this.handleConnectionClose();
    this.ws.onerror = (event) => this.handleConnectionError(new ConnectionError("WebSocket error", event as unknown as Error));
  }

  private handleConnectionOpen(): void {
    this.setState(ConnectionState.CONNECTED);
    this.reconnectAttempts = 0;
    this.notifyConnection(true);
    this.callbacks.onConnect?.();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        this.handleRequestResponse(message);
        return;
      }
      this.handleBroadcast(message);
      this.callbacks.onMessage?.(message);
    } catch (error) {
      console.error("[WebSocket] Message parsing error:", error);
    }
  }

  private handleBroadcast(message: WebSocketMessage): void {
    const t = message.type;
    if (t === "bot:request" || t === "bot:notice" || t === "bot:message") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zhin-console-bot-push", { detail: message }));
      }
      return;
    }
    if (t === "hmr:reload") {
      console.info(`[HMR] File changed, reloading...`);
      window.location.reload();
      return;
    }
    if (t === "system:restarting") {
      console.info("[System] Server restarting, will reload shortly...");
      setTimeout(() => window.location.reload(), 3000);
      return;
    }
  }

  private handleRequestResponse(message: WebSocketMessage): void {
    const { requestId } = message;
    const pending = this.pendingRequests.get(requestId!);
    if (!pending) return;
    this.pendingRequests.delete(requestId!);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new WebSocketError(message.error, "SERVER_ERROR"));
    } else {
      pending.resolve(message.data);
    }
  }

  private handleConnectionClose(): void {
    this.ws = null;
    this.notifyConnection(false);
    if (this.state === ConnectionState.DISCONNECTED) return;
    this.setState(ConnectionState.RECONNECTING);
    this.callbacks.onDisconnect?.();
    this.scheduleReconnect();
  }

  private handleConnectionError(error: Error): void {
    this.clearReconnectTimer();
    this.setState(ConnectionState.ERROR);
    console.error("[WebSocket] Connection error:", error);
    this.callbacks.onError?.(error as unknown as Event);
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setState(ConnectionState.ERROR);
      return;
    }
    this.reconnectAttempts++;
    const delay = this.config.reconnectInterval * this.reconnectAttempts;
    this.reconnectTimer = setTimeout(() => {
      if (this.state === ConnectionState.RECONNECTING) this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPendingRequests(): void {
    for (const [, { reject, timer }] of this.pendingRequests) {
      clearTimeout(timer);
      reject(new WebSocketError("Connection closed", "CONNECTION_CLOSED"));
    }
    this.pendingRequests.clear();
  }
}
