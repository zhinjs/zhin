import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket, MessageEvent } from 'ws';
import { Message } from '@/message';
import { ComServerMethods, UploadFileParams } from '@/types';
import { Router } from '@zhinjs/plugin-http-server';
import { ComWechatAdapter } from '@/index';
import { Dict } from 'zhin';
import { IncomingMessage } from 'http';

export class Client extends EventEmitter {
  self_id: string = '';
  constructor(
    private adapter: ComWechatAdapter,
    public config: Client.Config & Dict,
    private router: Router,
  ) {
    super();
    this.dispatch = this.dispatch.bind(this);
  }
  get app() {
    return this.adapter.app;
  }
  get logger() {
    return this.adapter.getLogger(this.self_id);
  }
  reTryCount = 0;
  ws?: WebSocket;
  wss: Map<string, WebSocketServer> = new Map<string, WebSocketServer>();

  async start() {
    switch (this.config.type) {
      case 'ws':
        return this.#connectWs(this.config as Client.Config<'ws'>);
      case 'ws_reverse':
        return this.#startWsServer(this.config as Client.Config<'ws_reverse'>);
      default:
        throw new Error(`unsupported type:${this.config.type}, supported types:'ws', 'ws_reverse'`);
    }
  }

  private dispatch(message: MessageEvent) {
    const result: Client.EventPayload | Client.ApiResult = JSON.parse(message?.toString() || 'null');
    if (!result) return;
    let temp: Client.EventPayload = result as any;
    if (temp.type === 'meta' && temp.detail_type === 'connect') this.self_id = temp.self?.user_id;
    this.logger.debug('recv source', result);
    if (result.retcode !== undefined && result.echo) return this.emit('echo', result.echo, result.data);
    const event: Client.EventPayload = result as Client.EventPayload;
    this.logger.debug('receive event', event);
    if (event.type === 'message') {
      if (event.detail_type === 'guild') {
        this.logger.info(`recv [${event.detail_type} ${event.guild_id}/${event.channel_id}]: ${event.alt_message}`);
      } else {
        this.logger.info(`recv [${event.detail_type} ${event.group_id || event.user_id}]: ${event.alt_message}`);
      }
    }
    this.emit(event.type, event);
  }

  #startWsServer(cfg: Client.Config<'ws_reverse'>) {
    const config: Dict<string> = {
      path: `${cfg.prefix || '/onebot/v12'}`,
      api_path: `${cfg.prefix || '/onebot/v12'}/api`,
      event_path: `${cfg.prefix || '/onebot/v12'}/event`,
    };
    Object.entries(config).map(([key, path]) => {
      const server = this.router.ws(path, {
        verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) => {
          const {
            req: { headers },
          } = info;
          if (!headers['sec-websocket-protocol']?.startsWith('12')) {
            this.logger.error('连接的协议不是有效的Client协议');
          }
          const authorization = headers['authorization'] || '';
          if (this.config.access_token && authorization !== `Bearer ${this.config.access_token}`) {
            this.logger.error('鉴权失败');
            return false;
          }
          return true;
        },
        handleProtocols(protocols, req) {
          return [...protocols][0] || false;
        },
      });
      if (['path', 'event_path'].includes(key))
        server.on('connection', (ws, req) => {
          this.logger.info(`已连接到协议端：${req.socket.remoteAddress}`);
          this.adapter.emit('bot-ready', this);
          ws.on('error', err => {
            this.logger.error('连接出错：', err);
          });
          ws.on('close', code => {
            this.logger.error(`与连接端(${req.socket.remoteAddress})断开，错误码：${code}`);
          });
          ws.on('message', this.dispatch);
        });
      this.logger.mark(`ws server is start at route path: ${path}`);
      this.wss.set(key, server);
    });
  }

  #connectWs(cfg: Client.Config<'ws'>) {
    const config: Required<Client.ConfigMap['ws']> = {
      url: cfg.url || 'ws://127.0.0.1:6700',
      max_reconnect_count: (cfg.max_reconnect_count ||= 10),
      reconnect_interval: (cfg.reconnect_interval ||= 3000),
    };
    this.ws = new WebSocket(config.url, {
      headers: {
        authorization: `Bearer ${cfg.access_token}`,
      },
    });
    this.ws.on('open', () => {
      this.logger.mark(`connected to ${config.url}`);
      this.adapter.emit('bot-ready', this);
      this.reTryCount = 0;
    });
    this.ws.on('message', this.dispatch);
    this.ws.on('error', e => {
      this.logger.error(e?.message);
    });
    this.ws.on('close', () => {
      if (this.reTryCount < config.max_reconnect_count) {
        this.logger.mark(`reconnect after ${config.reconnect_interval} ms`);
        setTimeout(() => {
          this.reTryCount++;
          this.#connectWs(cfg);
        }, config.reconnect_interval);
      } else {
        this.logger.mark(`retry times is exceeded of ${config.max_reconnect_count}`);
      }
    });
  }

  async stop() {
    this.ws?.close();
    for (const [_, server] of this.wss) {
      server.close();
    }
  }

  sendPayload<T extends keyof ComServerMethods>(payload: {
    action: T;
    params: Parameters<ComServerMethods[T]>[0];
    echo?: number | string;
  }): Promise<ReturnType<ComServerMethods[T]>> {
    return new Promise<ReturnType<ComServerMethods[T]>>((resolve, reject) => {
      payload.echo = payload.echo || `${Date.now()}`;
      const timer = setTimeout(
        () => {
          this.off('echo', receiveHandler);
          reject('timeout');
        },
        this.config.timeout || 1000 * 30,
      );
      const receiveHandler = (resultEcho: string | number, result: Dict) => {
        if (resultEcho === payload.echo) {
          clearTimeout(timer);
          this.off('echo', receiveHandler);
          resolve(result as any);
        }
      };
      this.on('echo', receiveHandler);
      this.logger.debug('send payload', payload);
      if (this.config.type === 'ws') return this.ws!.send(JSON.stringify(payload));
      for (const [name, server] of this.wss) {
        if (name === 'event_path') continue;
        for (const ws of server.clients) {
          ws.send(JSON.stringify(payload));
        }
      }
    });
  }

  async sendPrivateMsg(user_id: string, message: Message.Sendable) {
    await this.sendPayload({
      action: 'send_message',
      params: { user_id, detail_type: 'private', message: await this.processMessage(message) },
    });
    this.logger.info(`try send [Private ${user_id}]: ${this.getBrief(message)}`);
  }
  async sendGroupMsg(group_id: string, message: Message.Sendable) {
    await this.sendPayload({
      action: 'send_message',
      params: { group_id, detail_type: 'group', message: await this.processMessage(message) },
    });
    this.logger.info(`try send [Group ${group_id}]: ${this.getBrief(message)}`);
  }
  getGroupList() {
    return this.sendPayload({
      action: 'get_group_list',
      params: {},
    });
  }
  getGroupInfo(group_id: string) {
    return this.sendPayload({
      action: 'get_group_info',
      params: { group_id },
    });
  }
  getFriendList() {
    return this.sendPayload({
      action: 'get_friend_list',
      params: {},
    });
  }
  getGroupMemberList(group_id: string) {
    return this.sendPayload({
      action: 'get_group_member_list',
      params: { group_id },
    });
  }
  getGroupMemberInfo(group_id: string, user_id: string) {
    return this.sendPayload({
      action: 'get_group_member_info',
      params: {
        group_id,
        user_id,
      },
    });
  }
  async searchContact(condition: string) {
    return (
      (await this.sendPayload({
        action: 'wx.search_contact_by_remark',
        params: { remark: condition },
      })) ||
      (await this.sendPayload({
        action: 'wx.search_contact_by_wxnumber',
        params: { wx_number: condition },
      })) ||
      (await this.sendPayload({
        action: 'wx.search_contact_by_nickname',
        params: { nickname: condition },
      }))
    );
  }
  setGroupName(group_id: string, group_name: string) {
    return this.sendPayload({
      action: 'set_group_name',
      params: { group_id, group_name },
    });
  }
  async uploadFile(params: UploadFileParams) {
    return await this.sendPayload({
      action: 'upload_file',
      params,
    });
  }
  async getWechatVersion() {
    return await this.sendPayload({
      action: 'wx.get_wechat_version',
      params: undefined,
    });
  }
  async setWechatVersion(version: string) {
    return await this.sendPayload({
      action: 'wx.set_wechat_version',
      params: { version },
    });
  }
  async getPublicAccountList() {
    return await this.sendPayload({
      action: 'wx.get_public_account_list',
      params: undefined,
    });
  }
  async followPublicAccount(user_id: string) {
    return await this.sendPayload({
      action: 'wx.follow_public_account',
      params: { user_id },
    });
  }
  async approveFriendRequest(v3: string, v4: string) {
    return await this.sendPayload({
      action: 'wx.accept_friend',
      params: { v3, v4 },
    });
  }
  async checkFriendStatus(user_id: string) {
    return await this.sendPayload({
      action: 'wx.check_friend_status',
      params: { user_id },
    });
  }
  async deleteFriend(user_id: string) {
    return await this.sendPayload({
      action: 'wx.delete_friend',
      params: { user_id },
    });
  }
  async setGroupAnnouncement(group_id: string, content: string) {
    return await this.sendPayload({
      action: 'wx.set_group_announcement',
      params: { group_id, announcement: content },
    });
  }
  async addGroupMember(group_id: string, user_id: string) {
    return await this.sendPayload({
      action: 'wx.add_groupmember',
      params: { group_id, user_id },
    });
  }
  async deleteGroupMember(group_id: string, user_id: string) {
    return await this.sendPayload({
      action: 'wx.delete_groupmember',
      params: { group_id, user_id },
    });
  }
  async getPublicHistory(public_id: string, offset: number) {
    return await this.sendPayload({
      action: 'wx.get_public_history',
      params: { public_id, offset },
    });
  }
  async setFriendRemark(friend_id: string, remark: string) {
    return await this.sendPayload({
      action: 'wx.set_remark',
      params: { user_id: friend_id, remark },
    });
  }
  async setGroupRemark(group_id: string, remark: string) {
    return await this.sendPayload({
      action: 'wx.set_remark',
      params: { user_id: group_id, remark },
    });
  }
  async setGroupNickname(group_id: string, nickname: string) {
    return await this.sendPayload({
      action: 'wx.set_group_nickname',
      params: { group_id, nickname },
    });
  }
  async sendForwardMsg(user_id: string, message_id: string) {
    return await this.sendPayload({
      action: 'wx.send_forward_msg',
      params: { user_id, message_id },
    });
  }
  async processMessage(message: Message.Sendable): Promise<Message.Segment[]> {
    if (!Array.isArray(message)) message = [message];
    const result: Message.Segment[] = [];
    for (const item of message) {
      if (typeof item === 'string')
        result.push({
          type: 'text',
          data: { text: item.replace(/</g, '\\<').replace(/>/g, '\\>') },
        });
      else {
        switch (item.type) {
          case 'video':
          case 'audio':
          case 'image':
          case 'file':
            const { file, type } = item.data;
            if (!file) {
              this.logger.error(`file cannot be empty`);
              continue;
            }
            const data = await this.uploadFile({
              type: 'data',
              name: `${Date.now()}.${type}`,
              data: file.replace('base64://', ''),
            });
            result.push({
              type: item.type,
              data,
            });
            break;
          case 'text':
            result.push({
              type: 'text',
              data: { text: item.data.text.replace(/</g, '\\<').replace(/>/g, '\\>') },
            });
            break;
          case 'location':
          default:
            result.push(item);
        }
      }
    }
    return result;
  }
  getBrief(message: Message.Sendable): string {
    if (typeof message === 'string') {
      return message;
    }
    if (Array.isArray(message)) {
      return message.map(m => this.getBrief(m)).join('');
    }
    if (message.type === 'text') {
      return message.data.text;
    }
    return `{${message.type},${Object.keys(message.data).join(',')}}`;
  }
}

export namespace Client {
  type WsConfig = {
    url?: string;
    max_reconnect_count?: number;
    reconnect_interval?: number;
  };
  export type ApiResult = {
    status: 'ok' | 'failed';
    retcode: 1400 | 1401 | 1403 | 1404;
    data: any;
    echo?: string | number;
  };
  export type EventPayload = {
    time: number;
    self_id: number;
    type: 'message' | 'notice' | 'request' | 'meta';
    detail_type: string;
  } & Dict;
  type WsReverseConfig = {
    prefix?: string;
  };

  export interface ConfigMap {
    ws?: WsConfig;
    ws_reverse?: WsReverseConfig;
  }

  export type Config<T extends keyof ConfigMap = keyof ConfigMap> = {
    type: T;
    access_token?: string;
    timeout?: number;
  } & ConfigMap[T];
  export const defaultConfig = {
    ws: {
      host: '0.0.0.0',
      port: 6700,
      max_reconnect_count: 10,
      reconnect_interval: 3000,
    },
    ws_reverse: {
      prefix: '/onebot/v12',
    },
  };
}
