/**
 * OneBot11 WebSocket 服务端（反向 WS）Bot
 */
import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import { clearInterval } from 'node:timers';
import { IncomingMessage } from 'http';
import {
  Bot,
  Message,
  SendOptions,
  segment,
  Notice,
  Request,
} from 'zhin.js';
import type { Router } from '@zhin.js/http';
import type {
  OneBot11WsServerConfig,
  OneBot11Message,
  ApiResponse,
} from './types.js';
import type { OneBot11Adapter } from './adapter.js';

export class OneBot11WsServer extends EventEmitter implements Bot<OneBot11WsServerConfig, OneBot11Message> {
  $connected: boolean;
  #wss?: WebSocketServer;
  #clientMap: Map<string, WebSocket> = new Map();
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  get logger() {
    return this.adapter.plugin.logger;
  }

  get $id() {
    return this.$config.name;
  }

  constructor(
    public adapter: OneBot11Adapter,
    public router: Router,
    public $config: OneBot11WsServerConfig,
  ) {
    super();
    this.$connected = false;
  }

  async $connect(): Promise<void> {
    if (!this.$config.access_token) this.logger.warn(`missing 'access_token', your OneBot protocol is not safely`);
    this.#wss = this.router.ws(this.$config.path, {
      verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) => {
        const { req: { headers } } = info;
        const authorization = headers['authorization'] || '';
        if (this.$config.access_token && authorization !== `Bearer ${this.$config.access_token}`) {
          this.logger.error('鉴权失败');
          return false;
        }
        return true;
      },
    });
    this.$connected = true;
    this.logger.info(`ws server start at path:${this.$config.path}`);
    this.#wss.on('connection', (client, req) => {
      this.startHeartbeat();
      this.logger.info(`已连接到协议端：${req.socket.remoteAddress}`);
      client.on('error', (err) => this.logger.warn(`OneBot11 反向 WS 连接错误: ${err instanceof Error ? err.message : String(err)}`));
      client.on('close', (code, reason) => {
        const reasonStr = reason?.toString?.() || String(reason ?? '');
        const codeHint = code === 1005 ? ' [无状态]' : code === 1006 ? ' [异常关闭]' : '';
        this.logger.warn(`OneBot11 反向 WS 与协议端(${req.socket.remoteAddress})连接已断开 (code=${code ?? '?'}${codeHint}${reasonStr ? `, reason=${reasonStr}` : ''})`);
        for (const [key, value] of this.#clientMap) {
          if (client === value) this.#clientMap.delete(key);
        }
      });
      client.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(client, message);
        } catch (error) {
          this.emit('error', error);
        }
      });
    });
  }

  async $disconnect(): Promise<void> {
    this.#wss?.close();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  $formatMessage(onebotMsg: OneBot11Message) {
    const msgId = [onebotMsg.self_id, onebotMsg.message_id].join(':');
    const channel = {
      id: [onebotMsg.self_id, (onebotMsg.group_id || onebotMsg.user_id)].join(':'),
      type: (onebotMsg.group_id ? 'group' : 'private') as 'group' | 'private',
    };
    const message = Message.from(onebotMsg, {
      $id: msgId,
      $adapter: 'onebot11',
      $bot: `${this.$config.name}`,
      $sender: {
        id: onebotMsg.user_id.toString(),
        name: onebotMsg.user_id.toString(),
      },
      $channel: channel,
      $content: onebotMsg.message,
      $raw: onebotMsg.raw_message,
      $timestamp: onebotMsg.time,
      $recall: async (): Promise<void> => await this.$recallMessage(msgId),
      $reply: async (content: any, quote?: boolean | string): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: 'reply', data: { message_id: msgId } });
        return await this.$sendMessage({
          ...channel,
          context: 'onebot11',
          bot: `${this.$config.name}`,
          content,
        });
      },
    });
    return message;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const messageData: any = { message: options.content };
    if (options.type === 'group') {
      const [self_id, id] = options.id.split(':');
      const result = await this.callApi(self_id, 'send_group_msg', {
        group_id: parseInt(id),
        ...messageData,
      });
      this.logger.debug(`${this.$config.name} send ${options.type}(${id}):${segment.raw(options.content)}`);
      return result.message_id.toString();
    }
    if (options.type === 'private') {
      const [self_id, id] = options.id.split(':');
      const result = await this.callApi(self_id, 'send_private_msg', {
        user_id: parseInt(id),
        ...messageData,
      });
      this.logger.debug(`${this.$config.name} send ${options.type}(${id}):${segment.raw(options.content)}`);
      return result.message_id.toString();
    }
    throw new Error('Either group_id or user_id must be provided');
  }

  async $recallMessage(id: string): Promise<void> {
    const [self_id, message_id] = id.split(':');
    await this.callApi(self_id, 'delete_msg', { message_id: parseInt(message_id) });
  }

  private getFirstSelfId(): string {
    const first = this.#clientMap.keys().next().value;
    if (!first) throw new Error('反向 WS 尚未有实现端连接');
    return first;
  }

  async kickMember(groupId: number, userId: number, rejectAddRequest: boolean = false): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_kick', { group_id: groupId, user_id: userId, reject_add_request: rejectAddRequest });
    return true;
  }

  async muteMember(groupId: number, userId: number, duration: number = 600): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_ban', { group_id: groupId, user_id: userId, duration });
    return true;
  }

  async muteAll(groupId: number, enable: boolean = true): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_whole_ban', { group_id: groupId, enable });
    return true;
  }

  async setAdmin(groupId: number, userId: number, enable: boolean = true): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_admin', { group_id: groupId, user_id: userId, enable });
    return true;
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_card', { group_id: groupId, user_id: userId, card });
    return true;
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_name', { group_id: groupId, group_name: name });
    return true;
  }

  async getMemberList(groupId: number): Promise<any[]> {
    const selfId = this.getFirstSelfId();
    return await this.callApi(selfId, 'get_group_member_list', { group_id: groupId });
  }

  async getGroupInfo(groupId: number): Promise<any> {
    const selfId = this.getFirstSelfId();
    return await this.callApi(selfId, 'get_group_info', { group_id: groupId });
  }

  async setTitle(groupId: number, userId: number, title: string, duration: number = -1): Promise<boolean> {
    const selfId = this.getFirstSelfId();
    await this.callApi(selfId, 'set_group_special_title', { group_id: groupId, user_id: userId, special_title: title, duration });
    return true;
  }

  private async callApi(self_id: string, action: string, params: any = {}): Promise<any> {
    const client = this.#clientMap.get(self_id);
    if (!client || client.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    const echo = `req_${++this.requestId}`;
    const message = { action, params, echo };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`API call timeout: ${action}`));
      }, 30000);
      this.pendingRequests.set(echo, { resolve, reject, timeout });
      client.send(JSON.stringify(message));
    });
  }

  private handleWebSocketMessage(client: WebSocket, message: any): void {
    if (message.echo && this.pendingRequests.has(message.echo)) {
      const request = this.pendingRequests.get(message.echo)!;
      this.pendingRequests.delete(message.echo);
      clearTimeout(request.timeout);
      const response = message as ApiResponse;
      if (response.status === 'ok') return request.resolve(response.data);
      return request.reject(new Error(`API error: ${response.retcode}`));
    }
    switch (message.post_type) {
      case 'message':
        return this.handleMessage(message);
      case 'notice':
        return this.handleNotice(message);
      case 'request':
        return this.handleRequest(message);
      case 'meta_event':
        return this.handleMetaEvent(client, message);
    }
  }

  private handleMetaEvent(client: WebSocket, message: any): void {
    switch (message.sub_type) {
      case 'heartbeat':
        break;
      case 'connect':
        this.#clientMap.set(message.self_id, client);
        this.logger.info(`client ${message.self_id} of ${this.$config.name} by ${this.$config.context} connected`);
        break;
    }
  }

  private handleMessage(onebotMsg: OneBot11Message): void {
    const message = this.$formatMessage(onebotMsg);
    this.adapter.emit('message.receive', message);
    this.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${onebotMsg.group_id || onebotMsg.user_id}):${segment.raw(message.$content)}`);
  }

  private handleNotice(event: any): void {
    const noticeTypeMap: Record<string, string> = {
      group_increase: 'group_member_increase',
      group_decrease: 'group_member_decrease',
      group_admin: 'group_admin_change',
      group_ban: 'group_ban',
      group_recall: 'group_recall',
      friend_recall: 'friend_recall',
      friend_add: 'friend_add',
      notify: event.sub_type === 'poke' ? (event.group_id ? 'group_poke' : 'friend_poke') : `notify_${event.sub_type}`,
      group_upload: 'group_upload',
    };
    const $type = noticeTypeMap[event.notice_type] || event.notice_type;
    const isGroup = !!event.group_id;
    const notice = Notice.from(event, {
      $id: `${event.self_id}:${event.time}_${event.notice_type}_${event.group_id || event.user_id}`,
      $adapter: 'onebot11',
      $bot: this.$config.name,
      $type,
      $subType: event.sub_type,
      $channel: {
        id: [event.self_id, (event.group_id || event.user_id)].join(':'),
        type: isGroup ? 'group' : 'private',
      },
      $operator: event.operator_id ? { id: event.operator_id.toString(), name: event.operator_id.toString() } : undefined,
      $target: event.user_id ? { id: event.user_id.toString(), name: event.user_id.toString() } : undefined,
      $timestamp: event.time || Math.floor(Date.now() / 1000),
    });
    this.adapter.emit('notice.receive', notice);
  }

  private handleRequest(event: any): void {
    const self_id = event.self_id?.toString() || '';
    const typeMap: Record<string, string> = {
      friend: 'friend_add',
      group: event.sub_type === 'invite' ? 'group_invite' : 'group_add',
    };
    const $type = typeMap[event.request_type] || event.request_type;
    const request = Request.from(event, {
      $id: event.flag || `${self_id}:${event.time}_${event.request_type}_${event.user_id}`,
      $adapter: 'onebot11',
      $bot: this.$config.name,
      $type,
      $subType: event.sub_type,
      $channel: {
        id: [self_id, (event.group_id || event.user_id)].join(':'),
        type: event.group_id ? 'group' : 'private',
      },
      $sender: { id: event.user_id?.toString() || '', name: event.user_id?.toString() || '' },
      $comment: event.comment,
      $timestamp: event.time || Math.floor(Date.now() / 1000),
      $approve: async (remark?: string) => {
        await this.callApi(
          self_id,
          event.request_type === 'friend' ? 'set_friend_add_request' : 'set_group_add_request',
          { flag: event.flag, approve: true, remark },
        );
      },
      $reject: async (reason?: string) => {
        await this.callApi(
          self_id,
          event.request_type === 'friend' ? 'set_friend_add_request' : 'set_group_add_request',
          { flag: event.flag, approve: false, reason },
        );
      },
    });
    this.adapter.emit('request.receive', request);
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval || 30000;
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.#wss?.clients || []) {
        if (client && client.readyState === WebSocket.OPEN) client.ping();
      }
    }, interval);
  }
}
