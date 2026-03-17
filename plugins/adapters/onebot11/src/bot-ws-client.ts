/**
 * OneBot11 WebSocket 客户端连接 Bot
 */
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { clearInterval } from 'node:timers';
import {
  Bot,
  Message,
  SendOptions,
  segment,
  Notice,
  Request,
} from 'zhin.js';
import type {
  OneBot11WsClientConfig,
  OneBot11Message,
  ApiResponse,
} from './types.js';
import type { OneBot11Adapter } from './adapter.js';


export class OneBot11WsClient extends EventEmitter implements Bot<OneBot11WsClientConfig, OneBot11Message> {
  $connected: boolean;
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
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

  constructor(public adapter: OneBot11Adapter, public $config: OneBot11WsClientConfig) {
    super();
    this.$connected = false;
  }

  get $id() {
    return this.$config.name;
  }

  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.$config.access_token) {
        headers['Authorization'] = `Bearer ${this.$config.access_token}`;
      }
      this.ws = new WebSocket(this.$config.url, { headers });

      this.ws.on('open', () => {
        this.$connected = true;
        if (!this.$config.access_token) this.logger.warn(`missing 'access_token', your OneBot protocol is not safely`);
        this.logger.info(`${this.$config.name} 已连接 (WS 正向: ${this.$config.url})`);
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          this.emit('error', error);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.$connected = false;
        const reasonStr = reason?.toString?.() || String(reason);
        const codeHint = code === 1005 ? ' [无状态，多为服务端/代理未发 close 帧即断开]' : code === 1006 ? ' [异常关闭]' : '';
        this.logger.warn(`${this.$config.name} 连接已断开 (code=${code}${codeHint}${reasonStr ? `, reason=${reasonStr}` : ''})，${this.$config.reconnect_interval || 5000}ms 后重连`);
        reject({ code, reason });
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
    for (const [, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }

  $formatMessage(onebotMsg: OneBot11Message) {
    const message = Message.from(onebotMsg, {
      $id: onebotMsg.message_id.toString(),
      $adapter: 'onebot11',
      $bot: `${this.$config.name}`,
      $sender: {
        id: onebotMsg.user_id.toString(),
        name: onebotMsg.user_id.toString(),
      },
      $channel: {
        id: (onebotMsg.group_id || onebotMsg.user_id).toString(),
        type: onebotMsg.group_id ? 'group' : 'private',
      },
      $content: onebotMsg.message,
      $raw: onebotMsg.raw_message,
      $timestamp: onebotMsg.time,
      $recall: async () => {
        await this.$recallMessage(message.$id);
      },
      $reply: async (content: any[], quote?: boolean | string): Promise<string> => {
        if (quote) content.unshift({ type: 'reply', data: { message_id: message.$id } });
        return await this.adapter.sendMessage({
          ...message.$channel,
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
      const result = await this.callApi('send_group_msg', {
        group_id: parseInt(options.id),
        ...messageData,
      });
      this.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
      return result.message_id.toString();
    }
    if (options.type === 'private') {
      const result = await this.callApi('send_private_msg', {
        user_id: parseInt(options.id),
        ...messageData,
      });
      this.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`);
      return result.message_id.toString();
    }
    throw new Error('Either group_id or user_id must be provided');
  }

  async $recallMessage(id: string): Promise<void> {
    await this.callApi('delete_msg', { message_id: parseInt(id) });
  }

  async kickMember(groupId: number, userId: number, rejectAddRequest: boolean = false): Promise<boolean> {
    try {
      await this.callApi('set_group_kick', {
        group_id: groupId,
        user_id: userId,
        reject_add_request: rejectAddRequest,
      });
      this.logger.info(`OneBot11 Bot ${this.$id} 踢出成员 ${userId}（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  async muteMember(groupId: number, userId: number, duration: number = 600): Promise<boolean> {
    try {
      await this.callApi('set_group_ban', {
        group_id: groupId,
        user_id: userId,
        duration,
      });
      this.logger.info(`OneBot11 Bot ${this.$id} ${duration > 0 ? `禁言成员 ${userId} ${duration}秒` : `解除成员 ${userId} 禁言`}（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  async muteAll(groupId: number, enable: boolean = true): Promise<boolean> {
    try {
      await this.callApi('set_group_whole_ban', { group_id: groupId, enable });
      this.logger.info(`OneBot11 Bot ${this.$id} ${enable ? '开启' : '关闭'}全员禁言（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }

  async setAdmin(groupId: number, userId: number, enable: boolean = true): Promise<boolean> {
    try {
      await this.callApi('set_group_admin', { group_id: groupId, user_id: userId, enable });
      this.logger.info(`OneBot11 Bot ${this.$id} ${enable ? '设置' : '取消'}管理员 ${userId}（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 设置管理员失败:`, error);
      throw error;
    }
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    try {
      await this.callApi('set_group_card', { group_id: groupId, user_id: userId, card });
      this.logger.info(`OneBot11 Bot ${this.$id} 设置成员 ${userId} 群名片为 "${card}"（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 设置群名片失败:`, error);
      throw error;
    }
  }

  async setTitle(groupId: number, userId: number, title: string, duration: number = -1): Promise<boolean> {
    try {
      await this.callApi('set_group_special_title', {
        group_id: groupId,
        user_id: userId,
        special_title: title,
        duration,
      });
      this.logger.info(`OneBot11 Bot ${this.$id} 设置成员 ${userId} 头衔为 "${title}"（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 设置头衔失败:`, error);
      throw error;
    }
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    try {
      await this.callApi('set_group_name', { group_id: groupId, group_name: name });
      this.logger.info(`OneBot11 Bot ${this.$id} 设置群名为 "${name}"（群 ${groupId}）`);
      return true;
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 设置群名失败:`, error);
      throw error;
    }
  }

  async getMemberList(groupId: number): Promise<any[]> {
    try {
      return await this.callApi('get_group_member_list', { group_id: groupId });
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 获取群成员列表失败:`, error);
      throw error;
    }
  }

  async getGroupInfo(groupId: number): Promise<any> {
    try {
      return await this.callApi('get_group_info', { group_id: groupId });
    } catch (error) {
      this.logger.error(`OneBot11 Bot ${this.$id} 获取群信息失败:`, error);
      throw error;
    }
  }

  private async callApi(action: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
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
      this.ws!.send(JSON.stringify(message));
    });
  }

  private handleWebSocketMessage(message: any): void {
    if (message.echo && this.pendingRequests.has(message.echo)) {
      const request = this.pendingRequests.get(message.echo)!;
      this.pendingRequests.delete(message.echo);
      clearTimeout(request.timeout);
      const response = message as ApiResponse;
      if (response.status === 'ok') return request.resolve(response.data);
      return request.reject(new Error(`API error: ${response.retcode}`));
    }
    if (message.post_type === 'message') {
      this.handleOneBot11Message(message);
    } else if (message.post_type === 'notice') {
      this.handleOneBot11Notice(message);
    } else if (message.post_type === 'request') {
      this.handleOneBot11Request(message);
    }
  }

  private handleOneBot11Notice(event: any): void {
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
      $id: `${event.time}_${event.notice_type}_${event.group_id || event.user_id}`,
      $adapter: 'onebot11',
      $bot: this.$config.name,
      $type,
      $subType: event.sub_type,
      $channel: {
        id: (event.group_id || event.user_id)?.toString() || '',
        type: isGroup ? 'group' : 'private',
      },
      $operator: event.operator_id ? { id: event.operator_id.toString(), name: event.operator_id.toString() } : undefined,
      $target: event.user_id ? { id: event.user_id.toString(), name: event.user_id.toString() } : undefined,
      $timestamp: event.time || Math.floor(Date.now() / 1000),
    });
    this.adapter.emit('notice.receive', notice);
  }

  private handleOneBot11Request(event: any): void {
    const typeMap: Record<string, string> = {
      friend: 'friend_add',
      group: event.sub_type === 'invite' ? 'group_invite' : 'group_add',
    };
    const $type = typeMap[event.request_type] || event.request_type;
    const request = Request.from(event, {
      $id: event.flag || `${event.time}_${event.request_type}_${event.user_id}`,
      $adapter: 'onebot11',
      $bot: this.$config.name,
      $type,
      $subType: event.sub_type,
      $channel: {
        id: (event.group_id || event.user_id)?.toString() || '',
        type: event.group_id ? 'group' : 'private',
      },
      $sender: { id: event.user_id?.toString() || '', name: event.user_id?.toString() || '' },
      $comment: event.comment,
      $timestamp: event.time || Math.floor(Date.now() / 1000),
      $approve: async (remark?: string) => {
        await this.callApi(
          event.request_type === 'friend' ? 'set_friend_add_request' : 'set_group_add_request',
          { flag: event.flag, approve: true, remark },
        );
      },
      $reject: async (reason?: string) => {
        await this.callApi(
          event.request_type === 'friend' ? 'set_friend_add_request' : 'set_group_add_request',
          { flag: event.flag, approve: false, reason },
        );
      },
    });
    this.adapter.emit('request.receive', request);
  }

  private handleOneBot11Message(onebotMsg: OneBot11Message): void {
    const message = this.$formatMessage(onebotMsg);
    this.adapter.emit('message.receive', message);
    this.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
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
      try {
        await this.$connect();
      } catch (error) {
        this.emit('error', new Error(`Reconnection failed: ${error}`));
        this.scheduleReconnect();
      }
    }, interval);
  }
}
