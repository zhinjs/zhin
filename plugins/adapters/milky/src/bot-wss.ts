/**
 * Milky 反向 WebSocket Bot：应用开 WS 服务端，协议端来连；鉴权后收事件同正向
 */
import { IncomingMessage } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { clearInterval } from 'node:timers';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import type { Router } from '@zhin.js/http';
import { callApi } from './api.js';
import type { MilkyWssConfig, MilkyEvent } from './types.js';
import type { MilkyAdapter } from './adapter.js';
import {
  formatMilkyMessagePayload,
  parseMessageReceiveData,
  toMilkyOutgoingSegments,
  parseMilkyMessageId,
} from './utils.js';

function getAccessTokenFromWsRequest(req: IncomingMessage): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const url = req.url ?? '';
  const idx = url.indexOf('?');
  if (idx >= 0) {
    const params = new URLSearchParams(url.slice(idx));
    return params.get('access_token') ?? undefined;
  }
  return undefined;
}

export class MilkyWssServer extends EventEmitter implements Bot<MilkyWssConfig, MilkyEvent> {
  $connected: boolean;
  #wss?: WebSocketServer;
  #client?: WebSocket;
  private heartbeatTimer?: NodeJS.Timeout;

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: MilkyAdapter,
    public router: Router,
    public $config: MilkyWssConfig,
  ) {
    super();
    this.$connected = false;
  }

  get $id() {
    return this.$config.name;
  }

  private apiOptions() {
    return { baseUrl: this.$config.baseUrl, access_token: this.$config.access_token };
  }

  async $connect(): Promise<void> {
    const path = this.$config.path.startsWith('/') ? this.$config.path : `/${this.$config.path}`;
    const token = this.$config.access_token;
    if (!token) this.logger.warn('missing access_token, reverse WS is not secured');

    this.#wss = this.router.ws(path, {
      verifyClient: (info: { req: IncomingMessage }) => {
        const received = getAccessTokenFromWsRequest(info.req);
        if (token && received !== token) {
          this.logger.error('反向 WS 鉴权失败');
          return false;
        }
        return true;
      },
    });

    this.$connected = true;
    this.logger.info(`Milky 反向 WS 服务端已启动: ${path}`);

    this.#wss.on('connection', (client, req) => {
      this.#client = client;
      this.startHeartbeat();
      this.logger.info(`协议端已连接: ${req.socket?.remoteAddress}`);

      client.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString()) as MilkyEvent;
          this.handleEvent(event);
        } catch (err) {
          this.emit('error', err);
        }
      });

      client.on('close', () => {
        this.#client = undefined;
        this.logger.warn('协议端断开连接');
      });

      client.on('error', (err) => this.logger.error('反向 WS 连接错误', err));
    });
  }

  async $disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    this.#wss?.close();
    this.#wss = undefined;
    this.#client = undefined;
    this.$connected = false;
  }

  $formatMessage(event: MilkyEvent): Message<MilkyEvent> {
    const data = parseMessageReceiveData(event);
    if (!data) {
      return Message.from(event, {
        $id: '',
        $adapter: 'milky',
        $bot: this.$config.name,
        $channel: { id: '', type: 'private' },
        $sender: { id: '', name: '' },
        $content: [],
        $raw: '',
        $timestamp: event.time ?? 0,
        $recall: async () => {},
        $reply: async () => '',
      });
    }
    const payload = formatMilkyMessagePayload(
      event,
      data,
      (id) => this.$recallMessage(id),
      (channel, content) =>
        this.adapter.sendMessage({
          ...channel,
          context: 'milky',
          bot: this.$config.name,
          content: content as import('zhin.js').SendContent,
        }),
      'milky',
      this.$config.name,
    );
    return Message.from(event, payload);
  }

  private handleEvent(event: MilkyEvent): void {
    const data = parseMessageReceiveData(event);
    if (data) {
      const message = this.$formatMessage(event);
      this.adapter.emit('message.receive', message);
      this.logger.debug(
        `${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
      );
    }
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const content = Array.isArray(options.content) ? options.content : [options.content];
    const segments = content.map((c) =>
      typeof c === 'string' ? { type: 'text' as const, data: { text: c } } : (c as { type: string; data?: Record<string, unknown> }),
    );
    const message = toMilkyOutgoingSegments(segments);
    if (options.type === 'group') {
      const result = await callApi(this.apiOptions(), 'send_group_message', {
        group_id: parseInt(options.id, 10),
        message,
      });
      const seq = (result as { message_seq?: number }).message_seq;
      this.logger.debug(`${this.$config.name} send group(${options.id}):${segment.raw(options.content)}`);
      return seq != null ? `group:${options.id}:${seq}` : '';
    }
    if (options.type === 'private') {
      const result = await callApi(this.apiOptions(), 'send_private_message', {
        user_id: parseInt(options.id, 10),
        message,
      });
      const seq = (result as { message_seq?: number }).message_seq;
      this.logger.debug(`${this.$config.name} send private(${options.id}):${segment.raw(options.content)}`);
      return seq != null ? `friend:${options.id}:${seq}` : '';
    }
    throw new Error('Either group or private must be provided');
  }

  async $recallMessage(id: string): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      await callApi(this.apiOptions(), 'recall_group_message', {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    } else {
      await callApi(this.apiOptions(), 'recall_private_message', {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    }
  }

  async kickMember(groupId: number, userId: number, rejectAddRequest = false): Promise<boolean> {
    await callApi(this.apiOptions(), 'kick_group_member', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
    return true;
  }

  async muteMember(groupId: number, userId: number, duration = 600): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_mute', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
    return true;
  }

  async muteAll(groupId: number, enable = true): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_whole_mute', { group_id: groupId, is_mute: enable });
    return true;
  }

  async setAdmin(groupId: number, userId: number, enable = true): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_admin', {
      group_id: groupId,
      user_id: userId,
      is_set: enable,
    });
    return true;
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_card', {
      group_id: groupId,
      user_id: userId,
      card,
    });
    return true;
  }

  async setTitle(groupId: number, userId: number, title: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
    });
    return true;
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_name', { group_id: groupId, new_group_name: name });
    return true;
  }

  async getMemberList(groupId: number): Promise<unknown[]> {
    return callApi(this.apiOptions(), 'get_group_member_list', { group_id: groupId }) as Promise<unknown[]>;
  }

  async getGroupInfo(groupId: number): Promise<unknown> {
    return callApi(this.apiOptions(), 'get_group_info', { group_id: groupId });
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.#client?.readyState === WebSocket.OPEN) this.#client.ping();
    }, interval);
  }
}
