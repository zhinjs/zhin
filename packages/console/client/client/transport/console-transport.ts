import {
  ConnectionState,
  ConnectionError,
  ConsoleTransportError,
  MessageError,
  type ConsoleTransportMessage,
  type ConsoleTransportConfig,
  type ConsoleTransportCallbacks,
} from './types.js';
import { getApiBase, getToken, resolveApiUrl } from '../console-utils/remoteApi.js';
import { applyConsoleEvent } from "../persistence/idb-store.js";
import { fetchConsoleEventHistory } from '../console-events.js';
import {
  CONFIG_RPC,
  PLUGIN_RPC,
  ENDPOINT_RPC,
  CONSOLE_EVENT_RECOVERY_GAP_EVENT,
  SIDE_EVENT_PUSH,
  parseConsoleSseFrame,
  type ConsoleEventData,
  type ConsoleEventEnvelope,
  type ConsoleEventHistoryPage,
  type ConsoleEventHistoryQuery,
  type ConsoleConfigSource,
} from "@zhin.js/console-protocol";

interface ConsoleEventCursor {
  readonly runtimeId: string;
  readonly eventId: number;
}

export type ConsoleEventListener<Type extends string> = (
  event: ConsoleEventEnvelope<Type, ConsoleEventData<Type>>,
) => void;
export interface ConsoleEventRecoveryGap {
  readonly query: ConsoleEventHistoryQuery;
  readonly page: ConsoleEventHistoryPage;
}
export type ConsoleEventRecoveryGapListener = (gap: ConsoleEventRecoveryGap) => void;

export class ConsoleTransport {
  private config: Required<ConsoleTransportConfig>;
  private callbacks: ConsoleTransportCallbacks;
  private state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId = 0;
  private connectedListeners = new Set<(connected: boolean) => void>();
  private eventListeners = new Map<string, Set<ConsoleEventListener<string>>>();
  private recoveryGapListeners = new Set<ConsoleEventRecoveryGapListener>();
  private sseAbort: AbortController | null = null;
  private eventRuntimeId = '';
  private lastEventId = 0;
  private durableCursorBlocked = false;
  private disposed = false;
  private connectionGeneration = 0;

  constructor(config: ConsoleTransportConfig = {}, callbacks: ConsoleTransportCallbacks = {}) {
    this.config = {
      fetch: config.fetch ?? globalThis.fetch,
      reconnectInterval: config.reconnectInterval ?? 3000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      requestTimeout: config.requestTimeout ?? 10000,
    };
    this.callbacks = callbacks;
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.assertActive();
    this.connectedListeners.add(listener);
    return () => this.connectedListeners.delete(listener);
  }

  /** Subscribe by event name; known names infer their exact payload type. */
  onConsoleEvent<Type extends string>(type: Type, listener: ConsoleEventListener<Type>): () => void {
    this.assertActive();
    let listeners = this.eventListeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(type, listeners);
    }
    const stored = listener as ConsoleEventListener<string>;
    listeners.add(stored);
    return () => {
      listeners?.delete(stored);
      if (listeners?.size === 0) this.eventListeners.delete(type);
    };
  }

  /** Observe a non-resumable cursor so domain views can perform a full resync. */
  onConsoleEventRecoveryGap(listener: ConsoleEventRecoveryGapListener): () => void {
    this.assertActive();
    this.recoveryGapListeners.add(listener);
    return () => this.recoveryGapListeners.delete(listener);
  }

  private notifyConnection(connected: boolean) {
    for (const l of this.connectedListeners) l(connected);
  }

  connect(): void {
    this.assertActive();
    if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.CONNECTING) return;
    const generation = ++this.connectionGeneration;
    void this.connectSse(generation);
  }

  private async connectSse(generation: number): Promise<void> {
    // Host without http.token allows unauthenticated SSE (authenticateHttp
    // returns full when TokenRegistry is empty). Still open the stream so
    // local dev Console receives hmr:reload / message.receive broadcasts.
    const token = getToken();
    this.setState(ConnectionState.CONNECTING);
    this.sseAbort?.abort();
    this.sseAbort = new AbortController();
    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      await this.recoverEventHistory(this.sseAbort.signal);
      if (!this.isCurrentConnection(generation)) return;
      const params = new URLSearchParams();
      if (this.eventRuntimeId) params.set('runtimeId', this.eventRuntimeId);
      if (this.lastEventId > 0) params.set('after', String(this.lastEventId));
      const suffix = params.size ? `?${params}` : '';
      const res = await this.config.fetch(resolveApiUrl(`/api/events${suffix}`), {
        headers,
        signal: this.sseAbort.signal,
      });
      if (!this.isCurrentConnection(generation)) {
        await res.body?.cancel();
        return;
      }
      if (!res.ok || !res.body) {
        throw new ConnectionError(`SSE failed: HTTP ${res.status}`);
      }
      this.setState(ConnectionState.CONNECTED);
      this.reconnectAttempts = 0;
      this.notifyConnection(true);
      this.callbacks.onConnect?.();
      void this.pumpSse(res.body, generation);
    } catch (error) {
      if (!this.isCurrentConnection(generation)) return;
      if ((error as Error).name === "AbortError") return;
      // Reconnect timers only run while the transport remains in RECONNECTING.
      const connectionError = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError?.(connectionError);
      console.error("[Console transport] SSE connect error:", connectionError);
      this.setState(ConnectionState.RECONNECTING);
      this.notifyConnection(false);
      this.scheduleReconnect();
    }
  }

  private async pumpSse(
    body: ReadableStream<Uint8Array>,
    generation: number,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || !this.isCurrentConnection(generation)) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/u);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const parsed = parseConsoleSseFrame(part);
          if (!parsed) continue;
          const runtimeId = parsed.runtimeId ?? this.eventRuntimeId;
          const event: ConsoleEventEnvelope = Object.freeze({
            runtimeId,
            eventId: parsed.eventId ?? 0,
            type: parsed.type,
            data: parsed.data,
            timestamp: parsed.timestamp ?? Date.now(),
            delivery: 'live',
          });
          await this.deliverConsoleEvent(event);
        }
      }
    } catch {
      /* closed */
    } finally {
      if (this.isCurrentConnection(generation) && this.state === ConnectionState.CONNECTED) {
        this.notifyConnection(false);
        this.setState(ConnectionState.RECONNECTING);
        this.callbacks.onDisconnect?.();
        this.scheduleReconnect();
      }
    }
  }

  private async recoverEventHistory(signal: AbortSignal): Promise<void> {
    const stored = this.eventRuntimeId
      ? { runtimeId: this.eventRuntimeId, eventId: this.lastEventId }
      : readEventCursor();
    let runtimeId = stored?.runtimeId;
    let after = stored?.eventId ?? 0;
    if (runtimeId) {
      this.eventRuntimeId = runtimeId;
      this.lastEventId = after;
    }
    for (;;) {
      const query = { runtimeId, after, limit: 500 } satisfies ConsoleEventHistoryQuery;
      const page = await fetchConsoleEventHistory(query, { signal, fetch: this.config.fetch });
      if (page.runtimeId !== runtimeId) {
        runtimeId = page.runtimeId;
        after = 0;
        this.lastEventId = 0;
        this.durableCursorBlocked = false;
      }
      this.eventRuntimeId = page.runtimeId;
      if (page.gap) this.notifyRecoveryGap({ query, page });
      for (const item of page.items) {
        await this.deliverConsoleEvent(Object.freeze({ ...item, delivery: 'history' }));
        after = item.eventId;
      }
      if (!page.hasMore) {
        this.lastEventId = Math.max(after, page.latestEventId);
        if (!this.durableCursorBlocked) {
          writeEventCursor({ runtimeId: page.runtimeId, eventId: this.lastEventId });
        }
        return;
      }
      after = page.nextAfter;
    }
  }

  private async deliverConsoleEvent(event: ConsoleEventEnvelope): Promise<void> {
    if (event.runtimeId && event.runtimeId !== this.eventRuntimeId) {
      this.eventRuntimeId = event.runtimeId;
      this.lastEventId = 0;
      this.durableCursorBlocked = false;
    }
    if (event.eventId > 0
      && event.runtimeId === this.eventRuntimeId
      && event.eventId <= this.lastEventId) return;
    const message: ConsoleTransportMessage = Object.freeze({
      type: event.type,
      data: event.data,
      runtimeId: event.runtimeId,
      eventId: event.eventId || undefined,
      timestamp: event.timestamp,
      delivery: event.delivery,
    });
    try {
      await applyConsoleEvent(message);
    } catch (error) {
      this.durableCursorBlocked = true;
      console.error('[Console transport] Failed to persist event:', error);
    }
    this.handleBroadcast(message);
    try {
      this.callbacks.onMessage?.(message);
    } catch (error) {
      console.error('[Console transport] onMessage listener failed:', error);
    }
    for (const listener of this.eventListeners.get(event.type) ?? []) {
      try {
        listener(event as ConsoleEventEnvelope<string, unknown>);
      } catch (error) {
        console.error('[Console transport] event listener failed:', error);
      }
    }
    if (event.eventId > 0 && event.runtimeId) {
      this.lastEventId = Math.max(this.lastEventId, event.eventId);
      if (!this.durableCursorBlocked) {
        writeEventCursor({ runtimeId: event.runtimeId, eventId: this.lastEventId });
      }
    }
  }

  private notifyRecoveryGap(gap: ConsoleEventRecoveryGap): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CONSOLE_EVENT_RECOVERY_GAP_EVENT, { detail: gap }));
    }
    for (const listener of this.recoveryGapListeners) {
      try {
        listener(gap);
      } catch (error) {
        console.error('[Console transport] recovery gap listener failed:', error);
      }
    }
  }

  disconnect(): void {
    const wasConnected = this.state === ConnectionState.CONNECTED;
    this.connectionGeneration += 1;
    this.clearReconnectTimer();
    this.sseAbort?.abort();
    this.sseAbort = null;
    this.setState(ConnectionState.DISCONNECTED);
    this.notifyConnection(false);
    if (wasConnected) this.callbacks.onDisconnect?.();
  }

  send(message: unknown): void {
    this.assertActive();
    void this.sendRequest(message);
  }

  async sendRequest<T = unknown>(message: unknown): Promise<T> {
    this.assertActive();
    // Host may run without http.token (local smoke). Only require a token when
    // one is configured client-side; otherwise POST without Authorization and
    // let the Host accept (TokenRegistry empty → full scope).
    const token = getToken();
    const requestId = ++this.requestId;
    const body = { ...(message as Record<string, unknown>), requestId };
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await this.config.fetch(resolveApiUrl("/api/console/request"), {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.requestTimeout),
      });
      const json = (await res.json()) as {
        success?: boolean;
        data?: T;
        error?: string;
        requestId?: number;
      };
      if (!res.ok || json.success === false) {
        throw new ConsoleTransportError(json.error ?? `HTTP ${res.status}`, "SERVER_ERROR");
      }
      return json.data as T;
    } catch (error) {
      if (error instanceof ConsoleTransportError) throw error;
      throw new MessageError("REST request failed", error as Error);
    }
  }

  isConnected(): boolean {
    return this.state === ConnectionState.CONNECTED;
  }

  getState(): ConnectionState {
    return this.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disconnect();
    this.disposed = true;
    this.connectedListeners.clear();
    this.eventListeners.clear();
    this.recoveryGapListeners.clear();
  }

  async getConfig(pluginName: string) {
    return this.sendRequest<unknown>({ type: CONFIG_RPC.GET, pluginName });
  }
  async planPluginInstall(packageName: string) {
    return this.sendRequest<{
      packageName: string;
      instanceKey: string;
      alreadyDeclared: boolean;
      alreadyInstalled: boolean;
      restartRequired: boolean;
      changes: { packageManifest: string; config: string };
      warnings: string[];
    }>({ type: PLUGIN_RPC.PLAN_INSTALL, packageName });
  }
  async installPlugin(packageName: string, expectedRevision?: string) {
    return this.sendRequest<{
      success: boolean;
      plan: Awaited<ReturnType<ConsoleTransport['planPluginInstall']>>;
      restartRequired: boolean;
    }>({ type: PLUGIN_RPC.INSTALL, packageName, expectedRevision });
  }
  async planPluginUninstall(packageName: string) {
    return this.sendRequest<{
      packageName: string;
      instanceKey: string;
      installed: boolean;
      declared: boolean;
      hasConfig: boolean;
      restartRequired: boolean;
    }>({ type: PLUGIN_RPC.PLAN_UNINSTALL, packageName });
  }
  async uninstallPlugin(packageName: string, expectedRevision?: string) {
    return this.sendRequest<{
      success: boolean;
      plan: Awaited<ReturnType<ConsoleTransport['planPluginUninstall']>>;
      restartRequired: boolean;
    }>({
      type: PLUGIN_RPC.UNINSTALL,
      packageName,
      confirmation: packageName,
      expectedRevision,
    });
  }
  async planPluginUpdate(packageName: string, targetVersion: string) {
    return this.sendRequest<{
      packageName: string;
      instanceKey: string;
      currentVersion: string | null;
      targetVersion: string;
      installed: boolean;
      declared: boolean;
      alreadyCurrent: boolean;
      restartRequired: boolean;
    }>({ type: PLUGIN_RPC.PLAN_UPDATE, packageName, targetVersion });
  }
  async updatePlugin(packageName: string, targetVersion: string, expectedRevision?: string) {
    return this.sendRequest<{
      success: boolean;
      plan: Awaited<ReturnType<ConsoleTransport['planPluginUpdate']>>;
      installedVersion: string;
      restartRequired: boolean;
    }>({ type: PLUGIN_RPC.UPDATE, packageName, targetVersion, expectedRevision });
  }
  async validatePluginConfig(pluginName: string, data: unknown) {
    return this.sendRequest<{
      valid: boolean;
      errors: Array<{ path: string; message: string }>;
      missingEnv: string[];
    }>({ type: PLUGIN_RPC.VALIDATE_CONFIG, pluginName, data });
  }
  async diagnosePlugin(pluginName: string) {
    return this.sendRequest<{
      pluginName: string;
      plan: unknown;
      validation: { valid: boolean; errors: Array<{ path: string; message: string }>; missingEnv: string[] };
    }>({ type: PLUGIN_RPC.DIAGNOSE, pluginName });
  }
  async setPluginEnabled(instanceKey: string, enabled: boolean) {
    return this.sendRequest<{
      success: boolean;
      instanceKey: string;
      enabled: boolean;
      disabled: string[];
      restartRequired: boolean;
      message: string;
    }>({ type: PLUGIN_RPC.SET_ENABLED, instanceKey, enabled });
  }
  async listPlugins() {
    return this.getRest<Array<Record<string, unknown>>>('/api/plugins');
  }
  async searchMarketplace(query: {
    keyword?: string;
    category?: string;
    official?: boolean;
    page?: number;
    pageSize?: number;
  } = {}) {
    const params = new URLSearchParams();
    const normalized = {
      q: query.keyword,
      category: query.category,
      official: query.official,
      page: query.page,
      size: query.pageSize,
    };
    for (const [key, value] of Object.entries(normalized)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return this.getRest<unknown>(`/pub/marketplace/search${params.size ? `?${params}` : ''}`);
  }
  async getMarketplacePlugin(packageName: string) {
    return this.getRest<unknown>(`/pub/marketplace/detail/${encodeURIComponent(packageName)}`);
  }
  async getPluginUpdates() {
    return this.getRest<Array<Record<string, unknown>>>('/api/marketplace/updates');
  }
  async testEndpoint(adapter: string, endpointKey: string) {
    return this.sendRequest<{
      reachable: boolean;
      connected: boolean;
      status?: 'online' | 'offline';
      phase: string;
      pendingLogin?: boolean;
      latencyMs: number;
      message: string;
    }>({ type: ENDPOINT_RPC.TEST, adapter, endpointKey });
  }
  async setConfig(pluginName: string, config: unknown) {
    return this.sendRequest<{ success?: boolean; reloaded?: boolean; message?: string }>({
      type: CONFIG_RPC.SET,
      pluginName,
      data: config,
    });
  }
  async getSchema(pluginName: string) {
    return this.sendRequest<unknown>({ type: "schema:get", pluginName });
  }
  async getAllConfigs() {
    return this.sendRequest<Record<string, unknown>>({ type: CONFIG_RPC.GET_ALL });
  }
  async getAllSchemas() {
    return this.sendRequest<Record<string, unknown>>({ type: "schema:get-all" });
  }
  async getConfigSource() {
    return this.sendRequest<ConsoleConfigSource>({ type: CONFIG_RPC.GET_SOURCE });
  }
  async replaceConfigSource(source: string, expectedRevision: string) {
    return this.sendRequest<{ success: boolean; revision: string; message?: string }>({
      type: CONFIG_RPC.REPLACE_SOURCE,
      source,
      expectedRevision,
    });
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
    return this.sendRequest<{ tree: import("./types.js").FileTreeNode[] }>({ type: "files:tree" });
  }
  async readFile(filePath: string) {
    return this.sendRequest<{ content: string; size: number }>({ type: "files:read", filePath });
  }
  async saveFile(filePath: string, content: string) {
    return this.sendRequest<{ success: boolean; message?: string }>({ type: "files:save", filePath, content });
  }
  async getDbInfo() {
    return this.sendRequest<import("./types.js").DatabaseInfo>({ type: "db:info" });
  }
  async getDbTables() {
    return this.sendRequest<{ tables: import("./types.js").TableInfo[] }>({ type: "db:tables" });
  }
  async dbSelect(table: string, page?: number, pageSize?: number, where?: unknown) {
    return this.sendRequest<import("./types.js").SelectResult>({ type: "db:select", table, page, pageSize, where });
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
    return this.sendRequest<{ entries: import("./types.js").KvEntry[] }>({ type: "db:kv:entries", table });
  }

  private async getRest<T>(path: string): Promise<T> {
    const token = getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await this.config.fetch(resolveApiUrl(path), {
      headers,
      signal: AbortSignal.timeout(this.config.requestTimeout),
    });
    const body = await response.json() as { success?: boolean; data?: T; error?: string };
    if (!response.ok || body.success === false) {
      throw new ConsoleTransportError(body.error ?? `HTTP ${response.status}`, 'SERVER_ERROR');
    }
    return body.data as T;
  }

  private setState(newState: ConnectionState): void {
    this.state = newState;
  }

  private handleBroadcast(message: ConsoleTransportMessage): void {
    const t = message.type;
    if (
      t === SIDE_EVENT_PUSH.REQUEST_RECEIVE
      || t === SIDE_EVENT_PUSH.NOTICE_RECEIVE
      || t === SIDE_EVENT_PUSH.MESSAGE_RECEIVE
    ) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("zhin-console-bot-push", { detail: message }));
      }
      return;
    }
    if (t === "hmr:reload" && message.delivery !== 'history') {
      console.info(`[HMR] File changed, reloading...`);
      window.location.reload();
      return;
    }
    if (t === "system:restarting" && message.delivery !== 'history') {
      console.info("[System] Server restarting, will reload shortly...");
      setTimeout(() => window.location.reload(), 3000);
      return;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      this.setState(ConnectionState.ERROR);
      this.notifyConnection(false);
      return;
    }
    this.reconnectAttempts++;
    // Keep / restore RECONNECTING so the timer callback's state guard passes.
    if (this.state !== ConnectionState.RECONNECTING) {
      this.setState(ConnectionState.RECONNECTING);
    }
    const delay = this.config.reconnectInterval * this.reconnectAttempts;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (
        this.state === ConnectionState.RECONNECTING
        || this.state === ConnectionState.DISCONNECTED
      ) {
        this.connect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('ConsoleTransport has been disposed');
  }

  private isCurrentConnection(generation: number): boolean {
    return !this.disposed && generation === this.connectionGeneration;
  }
}

function eventCursorStorageKey(): string {
  return `zhin.console.event-cursor:${getApiBase()}`;
}

function readEventCursor(): ConsoleEventCursor | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(eventCursorStorageKey()) ?? 'null') as Partial<ConsoleEventCursor> | null;
    return parsed
      && typeof parsed.runtimeId === 'string'
      && Number.isSafeInteger(parsed.eventId)
      && (parsed.eventId ?? -1) >= 0
      ? { runtimeId: parsed.runtimeId, eventId: parsed.eventId as number }
      : null;
  } catch {
    return null;
  }
}

function writeEventCursor(cursor: ConsoleEventCursor): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(eventCursorStorageKey(), JSON.stringify(cursor));
  } catch {
    // HTTP history remains available when browser storage is unavailable.
  }
}
