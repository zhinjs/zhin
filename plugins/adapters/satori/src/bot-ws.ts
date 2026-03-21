/**
 * Satori WebSocket Bot：应用连 SDK /v1/events，IDENTIFY 认证，收 EVENT 转 Message
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { clearInterval } from 'node:timers';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import { callSatoriApi } from './api.js';
import type { SatoriWsConfig, SatoriSignal, SatoriEventBody, SatoriLogin } from './types.js';
import { SatoriOpcode } from './types.js';
import type { SatoriAdapter } from './adapter.js';
import { formatSatoriMessagePayload, isMessageEvent } from './utils.js';

export class SatoriWsClient extends EventEmitter implements Bot<SatoriWsConfig, SatoriEventBody> {
  $connected: boolean;
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  /** READY 后得到的当前登录，用于 API 的 platform / userId */
  private login?: SatoriLogin;
  private lastSn?: number;

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(public adapter: SatoriAdapter, public $config: SatoriWsConfig) {
    super();
    this.$connected = false;
  }

  get $id() {
    return this.$config.name;
  }

  private get wsUrl(): string {
    const base = this.$config.baseUrl.replace(/\/$/, '');
    const url=new URL(base);
    if(this.$config.token) {
      url.searchParams.set('access_token', this.$config.token);
    }
    return url.toString();
  }

  private apiOptions(): { baseUrl: string; platform: string; userId: string; token?: string } {
    const platform = this.login?.platform ?? '';
    const userId = this.login?.user?.id ?? '';
    return { baseUrl: this.$config.baseUrl, platform, userId, token: this.$config.token };
  }

  private sendSignal(op: number, body?: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ op, body: body ?? {} }));
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval ?? 10000;
    this.heartbeatTimer = setInterval(() => {
      this.sendSignal(SatoriOpcode.PING);
    }, interval);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = 5000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.$connect().catch((err) => this.logger.warn('Satori 重连失败', err));
    }, delay);
  }

  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.$config.token) headers['Authorization'] = `Bearer ${this.$config.token}`
      this.ws = new WebSocket(this.wsUrl, { headers });

      this.ws.on('open', () => {
        this.$connected = true;
        this.logger.info(`${this.$config.name} 已连接 (WS: ${this.wsUrl})`);
        this.sendSignal(SatoriOpcode.IDENTIFY, {
          token: this.$config.token,
          sn: this.lastSn,
        });
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const signal = JSON.parse(data.toString()) as SatoriSignal;
          if (signal.op === SatoriOpcode.READY && signal.body?.logins) {
            const logins = signal.body.logins as SatoriLogin[];
            this.login = logins[0];
            if (!this.login?.platform || !this.login?.user?.id) {
              this.logger.warn('Satori READY 未包含 platform/user，API 调用可能失败');
            }
          } else if (signal.op === SatoriOpcode.EVENT && signal.body) {
            if (signal.body.sn != null) this.lastSn = signal.body.sn as number;
            this.handleEvent(signal.body as SatoriEventBody);
          }
        } catch (error) {
          this.emit('error', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.$connected = false;
        const reasonStr = reason?.toString?.() || String(reason);
        const codeHint = code === 1005 ? ' [无状态，多为服务端/代理未发 close 帧即断开]' : code === 1006 ? ' [异常关闭]' : '';
        this.logger.warn(`${this.$config.name} 连接已断开 (code=${code}${codeHint}${reasonStr ? `, reason=${reasonStr}` : ''})，5000ms 后重连`);
        reject(new Error(`Satori WS closed: ${code} ${reasonStr}`));
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.logger.warn(`${this.$config.name} WS 错误: ${error instanceof Error ? error.message : String(error)}`);
        reject(error);
      });
    });
  }

  async $disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.$connected = false;
  }

  private handleEvent(body: SatoriEventBody): void {
    if (isMessageEvent(body)) {
      const message = this.$formatMessage(body);
      this.adapter.emit('message.receive', message);
      this.logger.debug(
        `${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
      );
    }
  }

  $formatMessage(body: SatoriEventBody): Message<SatoriEventBody> {
    if (!isMessageEvent(body)) {
      return Message.from(body, {
        $id: '',
        $adapter: 'satori',
        $bot: this.$config.name,
        $channel: { id: '', type: 'private' },
        $sender: { id: '', name: '' },
        $content: [],
        $raw: '',
        $timestamp: body.timestamp ?? 0,
        $recall: async () => {},
        $reply: async () => '',
      });
    }
    const payload = formatSatoriMessagePayload(
      body,
      'satori',
      this.$config.name,
      (id) => this.$recallMessage(id),
      (channel, content, _quote) =>
        this.adapter.sendMessage({
          ...channel,
          context: 'satori',
          bot: this.$config.name,
          content: content as import('zhin.js').SendContent,
        }),
    );
    return Message.from(body, payload);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const channelId = options.id;
    const contentRaw = segment.raw(options.content);
    const result = await callSatoriApi(this.apiOptions(), 'message', 'create', {
      channel_id: channelId,
      content: contentRaw,
    });
    const list = Array.isArray(result) ? result : (result as { data?: unknown[] })?.data;
    const msg = list?.[0] as { id?: string } | undefined;
    const msgId = msg?.id ?? '';
    this.logger.debug(`${this.$config.name} send ${options.type}(${channelId}):${contentRaw}`);
    return msgId ? `${channelId}:${msgId}` : '';
  }

  async $recallMessage(id: string): Promise<void> {
    const [channelId, messageId] = id.includes(':') ? id.split(':') : ['', id];
    await callSatoriApi(this.apiOptions(), 'message', 'delete', { channel_id: channelId, message_id: messageId });
  }
}
