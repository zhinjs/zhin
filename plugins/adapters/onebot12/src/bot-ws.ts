/**
 * OneBot 12 正向 WebSocket Bot：应用连 OneBot 实现的 WS，收事件、发动作
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { clearInterval, clearTimeout } from 'node:timers';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import type { OneBot12WsConfig, OneBot12Event, OneBot12ActionRequest, OneBot12ActionResponse } from './types.js';
import type { OneBot12Adapter } from './adapter.js';
import { formatOneBot12MessagePayload, isMessageEvent, contentToOb12Segments } from './utils.js';

export class OneBot12WsClient extends EventEmitter implements Bot<OneBot12WsConfig, OneBot12Event> {
  $connected: boolean;
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>();

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(public adapter: OneBot12Adapter, public $config: OneBot12WsConfig) {
    super();
    this.$connected = false;
  }

  get $id() {
    return this.$config.name;
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      this.callAction('get_status', {}).catch(() => {});
    }, interval);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = this.$config.reconnect_interval ?? 5000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.$connect().catch((err) => this.logger.warn('OneBot12 重连失败', err));
    }, delay);
  }

  private callAction(action: string, params: Record<string, unknown>): Promise<OneBot12ActionResponse['data']> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket 未连接'));
    }
    const echo = `ob12_${++this.requestId}`;
    const req: OneBot12ActionRequest = { action, params, echo };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`OneBot12 动作超时: ${action}`));
      }, 30000);
      this.pendingRequests.set(echo, {
        resolve: (data: unknown) => resolve(data as OneBot12ActionResponse['data']),
        reject,
        timeout,
      });
      this.ws!.send(JSON.stringify(req));
    });
  }

  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      let connectUrl = this.$config.url;
      if (this.$config.access_token) {
        headers['Authorization'] = `Bearer ${this.$config.access_token}`;
        const url = new URL(this.$config.url);
        url.searchParams.set('access_token', this.$config.access_token);
        connectUrl = url.toString();
      }
      this.ws = new WebSocket(connectUrl, { headers });

      this.ws.on('open', () => {
        this.$connected = true;
        const safeUrl = new URL(connectUrl);
        safeUrl.searchParams.delete('access_token');
        this.logger.info(`${this.$config.name} 已连接 (WS 正向: ${safeUrl})`);
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString()) as OneBot12Event | OneBot12ActionResponse;
          if ('echo' in msg && typeof (msg as OneBot12ActionResponse).echo === 'string') {
            const resp = msg as OneBot12ActionResponse;
            const pending = this.pendingRequests.get(resp.echo!);
            if (pending) {
              this.pendingRequests.delete(resp.echo!);
              clearTimeout(pending.timeout);
              if (resp.status === 'ok') pending.resolve(resp.data);
              else pending.reject(new Error(`OneBot12 retcode=${resp.retcode}: ${resp.message}`));
            }
            return;
          }
          const ev = msg as OneBot12Event;
          if (ev.type === 'message' && isMessageEvent(ev)) {
            const message = this.$formatMessage(ev);
            this.adapter.emit('message.receive', message);
            this.logger.debug(`${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
          }
        } catch (error) {
          this.emit('error', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.$connected = false;
        const reasonStr = reason?.toString?.() || String(reason);
        const codeHint = code === 1005 ? ' [无状态，多为服务端/代理未发 close 帧即断开]' : code === 1006 ? ' [异常关闭]' : '';
        this.logger.warn(`${this.$config.name} 连接已断开 (code=${code}${codeHint}${reasonStr ? `, reason=${reasonStr}` : ''})，${this.$config.reconnect_interval ?? 5000}ms 后重连`);
        reject(new Error(`OneBot12 WS 关闭: ${code} ${reasonStr}`));
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        this.logger.warn(`${this.$config.name} WS 错误: ${err instanceof Error ? err.message : String(err)}`);
        reject(err);
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
    for (const [, p] of this.pendingRequests) {
      clearTimeout(p.timeout);
      p.reject(new Error('连接已关闭'));
    }
    this.pendingRequests.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.$connected = false;
  }

  $formatMessage(ev: OneBot12Event): Message<OneBot12Event> {
    if (!isMessageEvent(ev)) {
      return Message.from(ev, {
        $id: '',
        $adapter: 'onebot12',
        $bot: this.$config.name,
        $channel: { id: '', type: 'private' },
        $sender: { id: '', name: '' },
        $content: [],
        $raw: '',
        $timestamp: ev.time ?? 0,
        $recall: async () => {},
        $reply: async () => '',
      });
    }
    const payload = formatOneBot12MessagePayload(
      ev,
      this.$config.name,
      (id) => this.$recallMessage(id),
      (channel, content, _quote) =>
        this.adapter.sendMessage({
          ...channel,
          context: 'onebot12',
          bot: this.$config.name,
          content: content as import('zhin.js').SendContent,
        }),
    );
    return Message.from(ev, payload);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const message = contentToOb12Segments(options.content);
    const params: Record<string, unknown> = { message };
    if (options.type === 'private') {
      params.detail_type = 'private';
      params.user_id = options.id;
    } else if (options.type === 'group') {
      params.detail_type = 'group';
      params.group_id = options.id;
    } else {
      const [guildId, channelId] = options.id.includes(':') ? options.id.split(':') : [undefined, options.id];
      params.detail_type = 'channel';
      params.channel_id = channelId ?? options.id;
      if (guildId) params.guild_id = guildId;
    }
    const data = await this.callAction('send_message', params) as { message_id?: string } | undefined;
    const msgId = data?.message_id ?? '';
    this.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
    return msgId;
  }

  async $recallMessage(id: string): Promise<void> {
    await this.callAction('delete_message', { message_id: id });
  }
}
