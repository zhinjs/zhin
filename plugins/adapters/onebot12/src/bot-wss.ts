/**
 * OneBot 12 反向 WebSocket Bot：应用开 WS 服务端，OneBot 实现连上来
 */
import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { clearInterval, clearTimeout } from 'node:timers';
import { IncomingMessage } from 'http';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import type { Router } from '@zhin.js/http';
import type { OneBot12WssConfig, OneBot12Event, OneBot12ActionRequest, OneBot12ActionResponse } from './types.js';
import type { OneBot12Adapter } from './adapter.js';
import { formatOneBot12MessagePayload, isMessageEvent, contentToOb12Segments } from './utils.js';

export class OneBot12WssServer extends EventEmitter implements Bot<OneBot12WssConfig, OneBot12Event> {
  $connected: boolean = false;
  #wss?: WebSocketServer;
  #client?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void; timeout: NodeJS.Timeout }>();

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: OneBot12Adapter,
    public router: Router,
    public $config: OneBot12WssConfig,
  ) {
    super();
  }

  get $id() {
    return this.$config.name;
  }

  private getClient(): WebSocket | undefined {
    return this.#client && this.#client.readyState === WebSocket.OPEN ? this.#client : undefined;
  }

  private callAction(action: string, params: Record<string, unknown>): Promise<OneBot12ActionResponse['data']> {
    const client = this.getClient();
    if (!client) return Promise.reject(new Error('反向 WebSocket 未连接'));
    const echo = `ob12wss_${++this.requestId}`;
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
      client.send(JSON.stringify(req));
    });
  }

  async $connect(): Promise<void> {
    const path = this.$config.path.startsWith('/') ? this.$config.path : `/${this.$config.path}`;
    this.#wss = this.router.ws(path, {
      verifyClient: (info: { req: IncomingMessage }) => {
        const auth = info.req.headers['authorization'];
        if (this.$config.access_token && auth !== `Bearer ${this.$config.access_token}`) {
          this.logger.error('OneBot12 反向 WS 鉴权失败');
          return false;
        }
        return true;
      },
    });

    this.#wss.on('connection', (ws: WebSocket) => {
      if (this.#client && this.#client.readyState === WebSocket.OPEN) {
        this.#client.close();
      }
      this.#client = ws;
      this.$connected = true;
      this.logger.info(`OneBot12 反向 WS 已连接: ${this.$config.name}`);

      ws.on('message', (data) => {
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

      ws.on('close', (code, reason) => {
        this.$connected = false;
        this.#client = undefined;
        const reasonStr = reason?.toString?.() || String(reason ?? '');
        const codeHint = code === 1005 ? ' [无状态]' : code === 1006 ? ' [异常关闭]' : '';
        this.logger.warn(`OneBot12 反向 WS ${this.$config.name} 连接已断开 (code=${code ?? '?'}${codeHint}${reasonStr ? `, reason=${reasonStr}` : ''})`);
      });

      ws.on('error', (err) => {
        this.logger.warn(`OneBot12 反向 WS ${this.$config.name} 错误: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
  }

  async $disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    for (const [, p] of this.pendingRequests) {
      clearTimeout(p.timeout);
      p.reject(new Error('连接已关闭'));
    }
    this.pendingRequests.clear();
    if (this.#client) {
      this.#client.close();
      this.#client = undefined;
    }
    this.#wss?.close();
    this.#wss = undefined;
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
    return data?.message_id ?? '';
  }

  async $recallMessage(id: string): Promise<void> {
    await this.callAction('delete_message', { message_id: id });
  }
}
