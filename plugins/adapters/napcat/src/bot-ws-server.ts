/**
 * NapCat 反向 WebSocket 连接
 */
import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import { NapCatBotBase } from './bot-base.js';
import type { NapCatWsServerConfig, ApiResponse } from './types.js';
import type { NapCatAdapter } from './adapter.js';
import type { Router } from '@zhin.js/http';

export class NapCatWsServer extends NapCatBotBase {
  #wss?: WebSocketServer;
  #clientMap = new Map<string, WebSocket>();
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  declare $config: NapCatWsServerConfig;

  constructor(adapter: NapCatAdapter, public router: Router, config: NapCatWsServerConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    if (!this.$config.access_token) this.logger.warn(`[${this.$id}] missing 'access_token', connection is not secure`);
    this.#wss = this.router.ws(this.$config.path, {
      verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) => {
        const authorization = info.req.headers['authorization'] || '';
        if (this.$config.access_token && authorization !== `Bearer ${this.$config.access_token}`) {
          this.logger.error(`[${this.$id}] auth failed`);
          return false;
        }
        return true;
      },
    });
    this.logger.info(`${this.$id} WS server started at path: ${this.$config.path}`);

    this.#wss.on('connection', (client, req) => {
      this.startHeartbeat();
      this.logger.info(`${this.$id} client connected: ${req.socket.remoteAddress}`);

      client.on('error', (err) => this.logger.warn(`${this.$id} WS error: ${err instanceof Error ? err.message : String(err)}`));
      client.on('close', (code, reason) => {
        const reasonStr = reason?.toString?.() || '';
        this.logger.warn(`${this.$id} client disconnected (code=${code}${reasonStr ? `, reason=${reasonStr}` : ''})`);
        for (const [key, val] of this.#clientMap) {
          if (val === client) this.#clientMap.delete(key);
        }
        if (this.#clientMap.size === 0) this.$connected = false;
      });
      client.on('message', (data) => {
        try { this.handleWsMessage(client, JSON.parse(data.toString())); } catch (e) { this.emit('error', e); }
      });
    });
  }

  async $disconnect(): Promise<void> {
    this.#wss?.close();
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
    for (const [, req] of this.pendingRequests) { clearTimeout(req.timeout); req.reject(new Error('Connection closed')); }
    this.pendingRequests.clear();
    this.$connected = false;
  }

  async callApi<T = any>(action: string, params: Record<string, any> = {}): Promise<T> {
    const selfId = this.getFirstSelfId();
    const client = this.#clientMap.get(selfId);
    if (!client || client.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected');
    const echo = `req_${++this.requestId}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pendingRequests.delete(echo); reject(new Error(`API call timeout: ${action}`)); }, 30000);
      this.pendingRequests.set(echo, { resolve, reject, timeout });
      client.send(JSON.stringify({ action, params, echo }));
    });
  }

  private getFirstSelfId(): string {
    const first = this.#clientMap.keys().next().value;
    if (!first) throw new Error('No NapCat client connected to reverse WS');
    return first;
  }

  private handleWsMessage(client: WebSocket, message: any): void {
    if (message.self_id != null) {
      const selfIdStr = String(message.self_id);
      if (!this.#clientMap.has(selfIdStr) || this.#clientMap.get(selfIdStr) !== client) {
        this.#clientMap.set(selfIdStr, client);
        if (!this.$connected) this.$connected = true;
      }
    }
    if (message.echo && this.pendingRequests.has(message.echo)) {
      const req = this.pendingRequests.get(message.echo)!;
      this.pendingRequests.delete(message.echo);
      clearTimeout(req.timeout);
      const resp = message as ApiResponse;
      if (resp.status === 'ok') return req.resolve(resp.data);
      return req.reject(new Error(`API error [${resp.retcode}]: ${resp.message || resp.wording || 'unknown'}`));
    }

    if (message.post_type === 'meta_event' && message.sub_type === 'connect') {
      this.#clientMap.set(String(message.self_id), client);
      this.$connected = true;
      this.logger.info(`${this.$id} client ${message.self_id} connected via lifecycle`);
      return;
    }
    this.dispatchEvent(message);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const interval = this.$config.heartbeat_interval || 30000;
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.#wss?.clients || []) {
        if (client.readyState === WebSocket.OPEN) client.ping();
      }
    }, interval);
  }
}
