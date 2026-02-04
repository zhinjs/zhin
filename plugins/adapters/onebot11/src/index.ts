import WebSocket, { WebSocketServer } from 'ws';
import { EventEmitter } from "events";
import {
  Bot,
  Plugin,
  Adapter,
  usePlugin,
  Message,
  MessageSegment,
  SendOptions,
  segment,
  SendContent,
  Tool,
  ToolPermissionLevel,
} from 'zhin.js';
import type { Router } from '@zhin.js/http'
import { IncomingMessage } from "http";
import { clearInterval } from "node:timers";

// 类型扩展 - 使用 zhin.js 模式
declare module 'zhin.js' {

  interface Adapters {
    'onebot11': OneBot11Adapter;
    'onebot11.wss': OneBot11WssAdapter;
  }
}

// OneBot11 发送者权限信息
export interface OneBot11SenderInfo {
  id: string;
  name: string;
  /** 群角色 */
  role?: 'owner' | 'admin' | 'member';
  /** 是否为群主 */
  isOwner?: boolean;
  /** 是否为管理员 */
  isAdmin?: boolean;
  /** 群名片 */
  card?: string;
  /** 头衔 */
  title?: string;
}
// ============================================================================
// OneBot11 配置和类型
// ============================================================================

export interface OneBot11Config {
  context: 'onebot11';
  name: string;
  type: string
  access_token?: string;
}
export interface OneBot11WsClientConfig extends OneBot11Config {
  type: 'ws'
  url: string;
  reconnect_interval?: number;
  heartbeat_interval?: number;
}
export interface OneBot11WsServerConfig extends OneBot11Config {
  type: 'ws_reverse'
  path: string
  heartbeat_interval?: number;
}
export interface OneBot11HTTPConfig extends OneBot11Config {
  type: 'http_sse'
  port: number
  path: string
}

interface OneBot11Message {
  post_type: string;
  self_id: string
  message_type?: string;
  sub_type?: string;
  message_id: number;
  user_id: number;
  group_id?: number;
  message: Array<{
    type: string;
    data: Record<string, any>;
  }>;
  raw_message: string;
  time: number;
}

interface ApiResponse<T = any> {
  status: string;
  retcode: number;
  data: T;
  echo?: string;
}
const plugin = usePlugin();
const { provide, useContext } = plugin;

// ============================================================================
// OneBot11 适配器实现
// ============================================================================

export class OneBot11WsClient extends EventEmitter implements Bot<OneBot11WsClientConfig, OneBot11Message> {
  $connected: boolean
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(public adapter: OneBot11Adapter, public $config: OneBot11WsClientConfig) {
    super();
    this.$connected = false
  }

  get $id() {
    return this.$config.name;
  }


  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let wsUrl = this.$config.url;
      const headers: Record<string, string> = {};

      if (this.$config.access_token) {
        headers['Authorization'] = `Bearer ${this.$config.access_token}`;
      }
      this.ws = new WebSocket(wsUrl, { headers });

      this.ws.on('open', () => {
        this.$connected = true;
        if (!this.$config.access_token) plugin.logger.warn(`missing 'access_token', your OneBot protocol is not safely`)
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          this.emit('error', error)
        }
      });

      this.ws.on('close', (code, reason) => {
        this.$connected = false
        reject({ code, reason })
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
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

    // 清理所有待处理的请求
    for (const [id, request] of this.pendingRequests) {
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
        name: onebotMsg.user_id.toString()
      },
      $channel: {
        id: (onebotMsg.group_id || onebotMsg.user_id).toString(),
        type: onebotMsg.group_id ? 'group' : 'private'
      },
      $content: onebotMsg.message,
      $raw: onebotMsg.raw_message,
      $timestamp: onebotMsg.time,
      $recall: async () => {
        await this.$recallMessage(message.$id)
      },

      $reply: async (content: MessageSegment[], quote?: boolean | string): Promise<string> => {
        if (quote) content.unshift({ type: 'reply', data: { message_id: message.$id } })
        return await this.adapter.sendMessage({
          ...message.$channel,
          context: 'onebot11',
          bot: `${this.$config.name}`,
          content
        })
      }
    })
    return message
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const messageData: any = {
      message: options.content
    };
    if (options.type === 'group') {
      const result = await this.callApi('send_group_msg', {
        group_id: parseInt(options.id),
        ...messageData
      });
      plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
      return result.message_id.toString();
    } else if (options.type === 'private') {
      const result = await this.callApi('send_private_msg', {
        user_id: parseInt(options.id),
        ...messageData
      });
      plugin.logger.debug(`${this.$config.name} send ${options.type}(${options.id}):${segment.raw(options.content)}`)
      return result.message_id.toString();
    } else {
      throw new Error('Either group_id or user_id must be provided');
    }
    return '';
  }
  async $recallMessage(id: string): Promise<void> {
    await this.callApi('delete_msg', {
      message_id: parseInt(id)
    });
  }

  // ==================== 群管理 API ====================

  /**
   * 踢出群成员
   */
  async kickMember(groupId: number, userId: number, rejectAddRequest: boolean = false): Promise<boolean> {
    try {
      await this.callApi('set_group_kick', {
        group_id: groupId,
        user_id: userId,
        reject_add_request: rejectAddRequest,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} 踢出成员 ${userId}（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 踢出成员失败:`, error);
      throw error;
    }
  }

  /**
   * 禁言群成员
   */
  async muteMember(groupId: number, userId: number, duration: number = 600): Promise<boolean> {
    try {
      await this.callApi('set_group_ban', {
        group_id: groupId,
        user_id: userId,
        duration,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} ${duration > 0 ? `禁言成员 ${userId} ${duration}秒` : `解除成员 ${userId} 禁言`}（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 全员禁言
   */
  async muteAll(groupId: number, enable: boolean = true): Promise<boolean> {
    try {
      await this.callApi('set_group_whole_ban', {
        group_id: groupId,
        enable,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} ${enable ? '开启' : '关闭'}全员禁言（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 全员禁言操作失败:`, error);
      throw error;
    }
  }

  /**
   * 设置管理员
   */
  async setAdmin(groupId: number, userId: number, enable: boolean = true): Promise<boolean> {
    try {
      await this.callApi('set_group_admin', {
        group_id: groupId,
        user_id: userId,
        enable,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} ${enable ? '设置' : '取消'}管理员 ${userId}（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 设置管理员失败:`, error);
      throw error;
    }
  }

  /**
   * 设置群名片
   */
  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    try {
      await this.callApi('set_group_card', {
        group_id: groupId,
        user_id: userId,
        card,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} 设置成员 ${userId} 群名片为 "${card}"（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 设置群名片失败:`, error);
      throw error;
    }
  }

  /**
   * 设置群头衔
   */
  async setTitle(groupId: number, userId: number, title: string, duration: number = -1): Promise<boolean> {
    try {
      await this.callApi('set_group_special_title', {
        group_id: groupId,
        user_id: userId,
        special_title: title,
        duration,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} 设置成员 ${userId} 头衔为 "${title}"（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 设置头衔失败:`, error);
      throw error;
    }
  }

  /**
   * 设置群名
   */
  async setGroupName(groupId: number, name: string): Promise<boolean> {
    try {
      await this.callApi('set_group_name', {
        group_id: groupId,
        group_name: name,
      });
      plugin.logger.info(`OneBot11 Bot ${this.$id} 设置群名为 "${name}"（群 ${groupId}）`);
      return true;
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 设置群名失败:`, error);
      throw error;
    }
  }

  /**
   * 获取群成员列表
   */
  async getMemberList(groupId: number): Promise<any[]> {
    try {
      return await this.callApi('get_group_member_list', { group_id: groupId });
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 获取群成员列表失败:`, error);
      throw error;
    }
  }

  /**
   * 获取群信息
   */
  async getGroupInfo(groupId: number): Promise<any> {
    try {
      return await this.callApi('get_group_info', { group_id: groupId });
    } catch (error) {
      plugin.logger.error(`OneBot11 Bot ${this.$id} 获取群信息失败:`, error);
      throw error;
    }
  }

  private async callApi(action: string, params: any = {}): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const echo = `req_${++this.requestId}`;
    const message = {
      action,
      params,
      echo
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`API call timeout: ${action}`));
      }, 30000); // 30秒超时

      this.pendingRequests.set(echo, { resolve, reject, timeout });
      this.ws!.send(JSON.stringify(message));
    });
  }

  private handleWebSocketMessage(message: any): void {
    // 处理API响应
    if (message.echo && this.pendingRequests.has(message.echo)) {
      const request = this.pendingRequests.get(message.echo)!;
      this.pendingRequests.delete(message.echo);
      clearTimeout(request.timeout);

      const response = message as ApiResponse;
      if (response.status === 'ok') {
        return request.resolve(response.data);
      }
      return request.reject(new Error(`API error: ${response.retcode}`));
    }

    // 处理事件消息
    if (message.post_type === 'message') {
      this.handleOneBot11Message(message);
    } else if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
      // 心跳消息，暂时忽略
    }
  }

  private handleOneBot11Message(onebotMsg: OneBot11Message): void {
    const message = this.$formatMessage(onebotMsg);
    this.adapter.emit('message.receive', message);
    plugin.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval || 30000;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, interval);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

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
export class OneBot11WsServer extends EventEmitter implements Bot<OneBot11WsServerConfig, OneBot11Message> {
  $connected: boolean
  #wss?: WebSocketServer
  #clientMap: Map<string, WebSocket> = new Map<string, WebSocket>()
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  get $id() {
    return this.$config.name;
  }

  constructor(public adapter: OneBot11WssAdapter, public router: Router, public $config: OneBot11WsServerConfig) {
    super();
    this.$connected = false
  }
  async $connect(): Promise<void> {
    if (!this.$config.access_token) plugin.logger.warn(`missing 'access_token', your OneBot protocol is not safely`)
    this.#wss = this.router.ws(this.$config.path, {
      verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) => {
        const {
          req: { headers },
        } = info;
        const authorization = headers['authorization'] || '';
        if (this.$config.access_token && authorization !== `Bearer ${this.$config.access_token}`) {
          plugin.logger.error('鉴权失败');
          return false;
        }
        return true;
      }
    })
    this.$connected = true;
    plugin.logger.info(`ws server start at path:${this.$config.path}`)
    this.#wss.on('connection', (client, req) => {
      this.startHeartbeat();
      plugin.logger.info(`已连接到协议端：${req.socket.remoteAddress}`);
      client.on('error', err => {
        plugin.logger.error('连接出错：', err);
      });
      client.on('close', code => {
        plugin.logger.error(`与连接端(${req.socket.remoteAddress})断开，错误码：${code}`);
        for (const [key, value] of this.#clientMap) {
          if (client === value) this.#clientMap.delete(key)
        }
      });
      client.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(client, message);
        } catch (error) {
          this.emit('error', error)
        }
      })
    });
  }

  async $disconnect(): Promise<void> {
    this.#wss?.close();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      delete this.heartbeatTimer;
    }
  }
  $formatMessage(onebotMsg: OneBot11Message) {
    const message = Message.from(onebotMsg, {
      $id: onebotMsg.message_id.toString(),
      $adapter: 'onebot11',
      $bot: `${this.$config.name}`,
      $sender: {
        id: onebotMsg.user_id.toString(),
        name: onebotMsg.user_id.toString()
      },
      $channel: {
        id: [onebotMsg.self_id, (onebotMsg.group_id || onebotMsg.user_id)].join(':'),
        type: onebotMsg.group_id ? 'group' : 'private'
      },
      $content: onebotMsg.message,
      $raw: onebotMsg.raw_message,
      $timestamp: onebotMsg.time,
      $recall: async () => {
        await this.$recallMessage(message.$id)
      },
      $reply: async (content: SendContent, quote?: boolean | string): Promise<string> => {
        if (!Array.isArray(content)) content = [content];
        if (quote) content.unshift({ type: 'reply', data: { message_id: message.$id } })
        return await this.$sendMessage({
          ...message.$channel,
          context: 'onebot11',
          bot: `${this.$config.name}`,
          content  
        })
      }
    })
    return message
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const messageData: any = {
      message: options.content
    };
    if (options.type === 'group') {
      const [self_id, id] = options.id.split(':')
      const result = await this.callApi(self_id, 'send_group_msg', {
        group_id: parseInt(id),
        ...messageData
      });
      plugin.logger.debug(`${this.$config.name} send ${options.type}(${id}):${segment.raw(options.content)}`)
      return result.message_id.toString();
    } else if (options.type === 'private') {
      const [self_id, id] = options.id.split(':')
      const result = await this.callApi(self_id, 'send_private_msg', {
        user_id: parseInt(id),
        ...messageData
      });
      plugin.logger.debug(`${this.$config.name} send ${options.type}(${id}):${segment.raw(options.content)}`)
      return result.message_id.toString();
    } else {
      throw new Error('Either group_id or user_id must be provided');
    }
    return '';
  }
  async $recallMessage(id: string): Promise<void> {
    const [self_id, message_id] = id.split(':')
    await this.callApi(self_id, 'delete_msg', {
      message_id: parseInt(message_id)
    });
  }
  private async callApi(self_id: string, action: string, params: any = {}): Promise<any> {
    const client = this.#clientMap.get(self_id)
    if (!client || client.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const echo = `req_${++this.requestId}`;
    const message = {
      action,
      params,
      echo
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`API call timeout: ${action}`));
      }, 30000); // 30秒超时

      this.pendingRequests.set(echo, { resolve, reject, timeout });
      client.send(JSON.stringify(message));
    });
  }

  private handleWebSocketMessage(client: WebSocket, message: any): void {
    // 处理API响应
    if (message.echo && this.pendingRequests.has(message.echo)) {
      const request = this.pendingRequests.get(message.echo)!;
      this.pendingRequests.delete(message.echo);
      clearTimeout(request.timeout);

      const response = message as ApiResponse;
      if (response.status === 'ok') {
        return request.resolve(response.data);
      }
      return request.reject(new Error(`API error: ${response.retcode}`));
    }
    switch (message.post_type) {
      case 'message':
        return this.handleMessage(message);
      case 'meta_event':
        return this.handleMetaEvent(client, message)
    }
    // 处理事件消息
    if (message.post_type === 'message') {
    } else if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
      // 心跳消息，暂时忽略
    }
  }
  private handleMetaEvent(client: WebSocket, message: any) {
    switch (message.sub_type) {
      case 'heartbeat':
        break;
      case 'connect':
        this.#clientMap.set(message.self_id, client);
        plugin.logger.info(`client ${message.self_id} of ${this.$config.name} by ${this.$config.context} connected`)
        break;
    }
  }
  private handleMessage(onebotMsg: OneBot11Message): void {
    const message = this.$formatMessage(onebotMsg);
    this.adapter.emit('message.receive', message);
    plugin.logger.debug(`${this.$config.name} recv  ${message.$channel.type}(${onebotMsg.group_id || onebotMsg.user_id}):${segment.raw(message.$content)}`);
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval || 30000;
    this.heartbeatTimer = setInterval(() => {
      for (const client of this.#wss?.clients || []) {
        if (client && client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, interval);
  }
}

// 定义 Adapter 类
class OneBot11Adapter extends Adapter<OneBot11WsClient> {
  constructor(plugin: Plugin) {
    super(plugin, 'onebot11', []);
  }

  createBot(config: OneBot11WsClientConfig): OneBot11WsClient {
    return new OneBot11WsClient(this, config);
  }

  async start(): Promise<void> {
    this.registerOneBot11Tools();
    await super.start();
  }

  /**
   * 注册 OneBot11 平台群管理工具
   */
  private registerOneBot11Tools(): void {
    // 踢出成员工具
    this.addTool({
      name: 'onebot11_kick_member',
      description: '将成员踢出 QQ 群（需要管理员权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          user_id: { type: 'number', description: '要踢出的成员 QQ 号' },
          reject: { type: 'boolean', description: '是否拒绝再次加群，默认 false' },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, group_id, user_id, reject = false } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.kickMember(group_id, user_id, reject);
        return { success, message: success ? `已将 ${user_id} 踢出群` : '操作失败' };
      },
    });

    // 禁言成员工具
    this.addTool({
      name: 'onebot11_mute_member',
      description: '禁言 QQ 群成员',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          user_id: { type: 'number', description: '要禁言的成员 QQ 号' },
          duration: { type: 'number', description: '禁言时长（秒），0 表示解除禁言，默认 600' },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, group_id, user_id, duration = 600 } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.muteMember(group_id, user_id, duration);
        return { 
          success, 
          message: success 
            ? (duration > 0 ? `已禁言 ${user_id} ${duration} 秒` : `已解除 ${user_id} 的禁言`)
            : '操作失败' 
        };
      },
    });

    // 全员禁言工具
    this.addTool({
      name: 'onebot11_mute_all',
      description: '开启/关闭 QQ 群全员禁言',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          enable: { type: 'boolean', description: '是否开启全员禁言，默认 true' },
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, group_id, enable = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.muteAll(group_id, enable);
        return { success, message: success ? (enable ? '已开启全员禁言' : '已关闭全员禁言') : '操作失败' };
      },
    });

    // 设置管理员工具
    this.addTool({
      name: 'onebot11_set_admin',
      description: '设置/取消 QQ 群管理员（需要群主权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          user_id: { type: 'number', description: '成员 QQ 号' },
          enable: { type: 'boolean', description: '是否设为管理员，默认 true' },
        },
        required: ['bot', 'group_id', 'user_id'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_owner',
      execute: async (args) => {
        const { bot: botId, group_id, user_id, enable = true } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setAdmin(group_id, user_id, enable);
        return { 
          success, 
          message: success 
            ? (enable ? `已将 ${user_id} 设为管理员` : `已取消 ${user_id} 的管理员`)
            : '操作失败' 
        };
      },
    });

    // 设置群名片工具
    this.addTool({
      name: 'onebot11_set_card',
      description: '设置群成员的群名片',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          user_id: { type: 'number', description: '成员 QQ 号' },
          card: { type: 'string', description: '新的群名片' },
        },
        required: ['bot', 'group_id', 'user_id', 'card'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, group_id, user_id, card } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setCard(group_id, user_id, card);
        return { success, message: success ? `已将 ${user_id} 的群名片设为 "${card}"` : '操作失败' };
      },
    });

    // 设置头衔工具
    this.addTool({
      name: 'onebot11_set_title',
      description: '设置群成员的专属头衔（需要群主权限）',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          user_id: { type: 'number', description: '成员 QQ 号' },
          title: { type: 'string', description: '头衔名称' },
        },
        required: ['bot', 'group_id', 'user_id', 'title'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_owner',
      execute: async (args) => {
        const { bot: botId, group_id, user_id, title } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setTitle(group_id, user_id, title);
        return { success, message: success ? `已将 ${user_id} 的头衔设为 "${title}"` : '操作失败' };
      },
    });

    // 设置群名工具
    this.addTool({
      name: 'onebot11_set_group_name',
      description: '修改 QQ 群名称',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
          name: { type: 'string', description: '新的群名称' },
        },
        required: ['bot', 'group_id', 'name'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'group_admin',
      execute: async (args) => {
        const { bot: botId, group_id, name } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const success = await bot.setGroupName(group_id, name);
        return { success, message: success ? `已将群名修改为 "${name}"` : '操作失败' };
      },
    });

    // 获取群成员列表工具
    this.addTool({
      name: 'onebot11_list_members',
      description: '获取 QQ 群成员列表',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const members = await bot.getMemberList(group_id);
        return { 
          members: members.map((m: any) => ({
            user_id: m.user_id,
            nickname: m.nickname,
            card: m.card,
            role: m.role,
            title: m.title,
          })),
          count: members.length,
        };
      },
    });

    // 获取群信息工具
    this.addTool({
      name: 'onebot11_group_info',
      description: '获取 QQ 群信息',
      parameters: {
        type: 'object',
        properties: {
          bot: { type: 'string', description: 'Bot 名称' },
          group_id: { type: 'number', description: '群号' },
        },
        required: ['bot', 'group_id'],
      },
      platforms: ['onebot11'],
      scopes: ['group'],
      permissionLevel: 'user',
      execute: async (args) => {
        const { bot: botId, group_id } = args;
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        const info = await bot.getGroupInfo(group_id);
        return {
          group_id: info.group_id,
          group_name: info.group_name,
          member_count: info.member_count,
          max_member_count: info.max_member_count,
        };
      },
    });

    plugin.logger.debug('已注册 OneBot11 平台群管理工具');
  }
}

class OneBot11WssAdapter extends Adapter<OneBot11WsServer> {
  #router: Router;

  constructor(plugin: Plugin, router: Router) {
    super(plugin, 'onebot11.wss', []);
    this.#router = router;
  }

  createBot(config: OneBot11WsServerConfig): OneBot11WsServer {
    return new OneBot11WsServer(this, this.#router, config);
  }
}

// 使用新的 provide() API 注册适配器
provide({
  name: "onebot11",
  description: "OneBot11 WebSocket Client Adapter",
  mounted: async (p) => {
    const adapter = new OneBot11Adapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter) => {
    await adapter.stop();
  },
});

useContext('router', (router) => {
  provide({
    name: "onebot11.wss",
    description: "OneBot11 WebSocket Server Adapter",
    mounted: async (p) => {
      const adapter = new OneBot11WssAdapter(p, router);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter) => {
      await adapter.stop();
    },
  });
});