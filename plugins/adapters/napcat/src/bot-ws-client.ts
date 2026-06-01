/**
 * NapCat 正向 WebSocket 连接
 */
import WebSocket from 'ws';
import { formatCompact } from 'zhin.js';
import { NapCatBotBase } from './bot-base.js';
import type { NapCatWsClientConfig, ApiResponse } from './types.js';
import type { NapCatAdapter } from './adapter.js';
import { enableTypingIndicator } from './typing-indicator.js';

export class NapCatWsClient extends NapCatBotBase {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  declare $config: NapCatWsClientConfig;

  constructor(adapter: NapCatAdapter, config: NapCatWsClientConfig) {
    super(adapter, config);
  }

  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      let url = this.$config.url;
      if (this.$config.access_token) {
        headers['Authorization'] = `Bearer ${this.$config.access_token}`;
        const u = new URL(url);
        u.searchParams.set('access_token', this.$config.access_token);
        url = u.toString();
      }
      this.ws = new WebSocket(url, { headers });

      this.ws.on('open', () => {
        this.$connected = true;
        if (!this.$config.access_token) {
          this.logger.warn(formatCompact({ bot: this.$id, ok: false, error: 'missing access_token' }));
        }
        this.logger.info(formatCompact({ bot: this.$id, mode: 'ws' }));
        this.startHeartbeat();
        this.initTypingIndicator();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          this.handleWsMessage(JSON.parse(data.toString()));
        } catch (error) {
          this.emit('error', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.$connected = false;
        const reasonStr = reason?.toString?.() || '';
        const codeHint = code === 1005 ? ' [no status]' : code === 1006 ? ' [abnormal]' : '';
        this.logger.warn(formatCompact( {
          op: 'disconnect',
          bot: this.$id,
          code,
          error: reasonStr || 'closed',
          reconnect_ms: this.$config.reconnect_interval || 5000,
        }));
        reject({ code, reason });
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.logger.warn(formatCompact( {
          op: 'ws_error',
          bot: this.$id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }));
        reject(error);
      });
    });
  }

  async $disconnect(): Promise<void> {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = undefined; }
    for (const [, req] of this.pendingRequests) { clearTimeout(req.timeout); req.reject(new Error('Connection closed')); }
    this.pendingRequests.clear();
    if (this.ws) { this.ws.close(); this.ws = undefined; }
    this.inboundDeduper.clear();
    this.$connected = false;
  }

  async callApi<T = any>(action: string, params: Record<string, any> = {}): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not connected');
    const echo = `req_${++this.requestId}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pendingRequests.delete(echo); reject(new Error(`API call timeout: ${action}`)); }, 30000);
      this.pendingRequests.set(echo, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify({ action, params, echo }));
    });
  }

  private handleWsMessage(message: any): void {
    if (message.echo && this.pendingRequests.has(message.echo)) {
      const req = this.pendingRequests.get(message.echo)!;
      this.pendingRequests.delete(message.echo);
      clearTimeout(req.timeout);
      const resp = message as ApiResponse;
      if (resp.status === 'ok') return req.resolve(resp.data);
      return req.reject(new Error(`API error [${resp.retcode}]: ${resp.message || resp.wording || 'unknown'}`));
    }
    this.dispatchEvent(message);
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval || 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.ping();
    }, interval);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const interval = this.$config.reconnect_interval || 5000;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try { await this.$connect(); } catch { this.scheduleReconnect(); }
    }, interval);
  }

  protected handleMeta(event: any): void {
    if (event.meta_event_type === 'lifecycle' && event.sub_type === 'connect') {
      this.logger.info(formatCompact({ bot: this.$id, lifecycle: 'connect', self_id: event.self_id }));
    }
  }

  private initTypingIndicator(): void {
    const tiConfig = this.$config.typingIndicator;
    if (tiConfig && tiConfig.enabled !== false) {
      enableTypingIndicator(this, {
        enabled: tiConfig.enabled !== false,
        defaultEmoji: tiConfig.defaultEmoji || '128516',
        autoRemove: true,
        removeDelay: 5000,
        privateConfig: tiConfig.privateConfig ? {
          type: tiConfig.privateConfig.type || 'message',
          message: tiConfig.privateConfig.message || '正在思考中...',
          autoRemove: true,
          removeDelay: 3000,
        } : undefined,
        groupConfig: tiConfig.groupConfig ? {
          type: tiConfig.groupConfig.type || 'reaction',
          emoji: tiConfig.groupConfig.emoji || '128516',
          autoRemove: true,
          removeDelay: 5000,
        } : undefined,
      });
      this.logger.info(formatCompact({ bot: this.$id, typingIndicator: 'enabled' }));
    }
  }
}
