/**
 * HaWsTransport — HA WebSocket auth / subscribe / reconnect.
 * Inject createSocket for tests.
 */
import { getLogger } from '@zhin.js/core';
import { formatCompact } from '@zhin.js/logger';

const logger = getLogger('ha-ws-transport');
const RECONNECT_DELAY_MS = 10_000;

export type HaSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void;
};

export type CreateHaSocket = (url: string) => HaSocketLike;

export interface HaStateChangedEvent {
  entityId: string;
  newState: string;
  oldState?: string;
  attributes: Record<string, unknown>;
}

export interface HaWsTransportOptions {
  wsUrl: string;
  token: string;
  createSocket?: CreateHaSocket;
  onStateChanged: (event: HaStateChangedEvent) => void;
  reconnectDelayMs?: number;
}

const OPEN = 1;
const CONNECTING = 0;

interface HaWsMessage {
  id?: number;
  type: string;
  event?: {
    data?: {
      entity_id?: string;
      new_state?: { state?: string; attributes?: Record<string, unknown> };
      old_state?: { state?: string };
    };
  };
}

export class HaWsTransport {
  private ws: HaSocketLike | null = null;
  private disposed = false;
  private msgId = 1;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: CreateHaSocket;

  constructor(private readonly options: HaWsTransportOptions) {
    this.createSocket = options.createSocket
      ?? ((url) => new (globalThis as unknown as { WebSocket: new (u: string) => HaSocketLike }).WebSocket(url));
  }

  start(): void {
    if (this.disposed) return;
    if (typeof globalThis.WebSocket === 'undefined' && !this.options.createSocket) {
      logger.warn('ha-ws-transport: WebSocket not available');
      return;
    }
    this.connect();
  }

  private connect(): void {
    if (this.disposed) return;
    try {
      this.ws = this.createSocket(this.options.wsUrl);
    } catch (err) {
      logger.warn(formatCompact({ op: 'ha_ws_connect_error', error: String(err) }));
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      logger.debug('ha-ws connected');
    });
    this.ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as HaWsMessage;
        this.handleMessage(msg);
      } catch {
        // ignore
      }
    });
    this.ws.addEventListener('close', () => {
      logger.debug('ha-ws closed');
      this.scheduleReconnect();
    });
    this.ws.addEventListener('error', () => {
      logger.warn(formatCompact({ op: 'ha_ws_error' }));
    });
  }

  /** Test/helper: feed a parsed HA message as if received from the socket. */
  handleMessage(msg: HaWsMessage): void {
    switch (msg.type) {
      case 'auth_required':
        this.send({ type: 'auth', access_token: this.options.token });
        break;
      case 'auth_ok':
        this.subscribeEvents();
        break;
      case 'auth_invalid':
        logger.error('ha-ws auth failed — check restToken');
        this.dispose();
        break;
      case 'event':
        this.emitStateChange(msg);
        break;
    }
  }

  private subscribeEvents(): void {
    const id = this.msgId++;
    this.send({ id, type: 'subscribe_events', event_type: 'state_changed' });
    logger.info(formatCompact({ op: 'ha_ws_subscribed' }));
  }

  private emitStateChange(msg: HaWsMessage): void {
    const data = msg.event?.data;
    if (!data?.entity_id) return;
    const newState = data.new_state?.state ?? 'unknown';
    const oldState = data.old_state?.state;
    if (newState === oldState) return;
    this.options.onStateChanged({
      entityId: data.entity_id,
      newState,
      oldState,
      attributes: data.new_state?.attributes ?? {},
    });
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    const delay = this.options.reconnectDelayMs ?? RECONNECT_DELAY_MS;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      if (this.ws.readyState === OPEN || this.ws.readyState === CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }
}

export function buildWsUrl(restUrl: string): string {
  const url = new URL(restUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/websocket';
  return url.toString();
}
