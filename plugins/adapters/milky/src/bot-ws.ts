/**
 * Milky WebSocket 正向连接 Bot（应用连协议端 ws(s)://baseUrl/event）
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { clearInterval } from 'node:timers';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import { callApi } from './api.js';
import type { MilkyWsConfig, MilkyEvent } from './types.js';
import type { MilkyAdapter } from './adapter.js';
import {
  formatMilkyMessagePayload,
  parseMessageReceiveData,
  toMilkyOutgoingSegments,
  parseMilkyMessageId,
} from './utils.js';

export class MilkyWsClient extends EventEmitter implements Bot<MilkyWsConfig, MilkyEvent> {
  $connected: boolean;
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(public adapter: MilkyAdapter, public $config: MilkyWsConfig) {
    super();
    this.$connected = false;
  }

  get $id() {
    return this.$config.name;
  }

  private get eventUrl(): string {
    const base = this.$config.baseUrl.replace(/\/$/, '');
    const url = base.replace(/^http/, 'ws') + '/event';
    const token = this.$config.access_token;
    if (token) return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
    return url;
  }

  private apiOptions() {
    return { baseUrl: this.$config.baseUrl, access_token: this.$config.access_token };
  }

  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.$config.access_token) {
        headers['Authorization'] = `Bearer ${this.$config.access_token}`;
      }
      this.ws = new WebSocket(this.eventUrl, { headers });

      this.ws.on('open', () => {
        this.$connected = true;
        if (!this.$config.access_token) this.logger.warn('missing access_token, connection is not secured');
        this.logger.info(`${this.$config.name} 已连接 (WS 正向: ${this.$config.baseUrl})`);
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString()) as MilkyEvent;
          this.handleEvent(event);
        } catch (error) {
          this.emit('error', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.$connected = false;
        const reasonStr = reason?.toString?.() || String(reason);
        const codeHint = code === 1005 ? ' [无状态，多为服务端/代理未发 close 帧即断开]' : code === 1006 ? ' [异常关闭]' : '';
        this.logger.warn(`${this.$config.name} 连接已断开 (code=${code}${codeHint}${reasonStr ? `, reason=${reasonStr}` : ''})，${this.$config.reconnect_interval ?? 5000}ms 后重连`);
        reject(new Error(`WS closed: ${code} ${reasonStr}`));
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

  private handleEvent(event: MilkyEvent): void {
    const data = parseMessageReceiveData(event);
    if (data) {
      const message = this.$formatMessage(event);
      this.adapter.emit('message.receive', message);
      this.logger.debug(
        `${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
      );
    }
    // 其他 event_type 可在此扩展 Notice / Request
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
      (channel, content, _quote) =>
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
    this.logger.info(`Milky Bot ${this.$id} 踢出成员 ${userId}（群 ${groupId}）`);
    return true;
  }

  async muteMember(groupId: number, userId: number, duration = 600): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_mute', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
    this.logger.info(
      `Milky Bot ${this.$id} ${duration > 0 ? `禁言成员 ${userId} ${duration}秒` : `解除禁言 ${userId}`}（群 ${groupId}）`,
    );
    return true;
  }

  async muteAll(groupId: number, enable = true): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_whole_mute', { group_id: groupId, is_mute: enable });
    this.logger.info(`Milky Bot ${this.$id} ${enable ? '开启' : '关闭'}全员禁言（群 ${groupId}）`);
    return true;
  }

  async setAdmin(groupId: number, userId: number, enable = true): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_admin', {
      group_id: groupId,
      user_id: userId,
      is_set: enable,
    });
    this.logger.info(`Milky Bot ${this.$id} ${enable ? '设置' : '取消'}管理员 ${userId}（群 ${groupId}）`);
    return true;
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_card', {
      group_id: groupId,
      user_id: userId,
      card,
    });
    this.logger.info(`Milky Bot ${this.$id} 设置成员 ${userId} 群名片（群 ${groupId}）`);
    return true;
  }

  async setTitle(groupId: number, userId: number, title: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
    });
    this.logger.info(`Milky Bot ${this.$id} 设置成员 ${userId} 头衔（群 ${groupId}）`);
    return true;
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_name', { group_id: groupId, new_group_name: name });
    this.logger.info(`Milky Bot ${this.$id} 设置群名（群 ${groupId}）`);
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
    if (interval <= 0) return; // 设为 0 可关闭心跳（部分网关如 onebots 对 ping 处理异常时会 1006 断连）
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, interval);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const interval = this.$config.reconnect_interval ?? 5000;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.$connect().catch((err) => {
        this.emit('error', err);
        this.scheduleReconnect();
      });
    }, interval);
  }
}
