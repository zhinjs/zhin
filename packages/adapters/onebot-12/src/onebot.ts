import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket, MessageEvent } from 'ws';
import { MessageV12 } from '@/message';
import { OneBotMethodsV12 } from '@/types';
import { Router } from '@zhinjs/plugin-http-server';
import { OneBotV12Adapter } from '@/index';
import { Dict } from 'zhin';
import { IncomingMessage } from 'http';

export class OneBotV12 extends EventEmitter {
  self_id: string = '';
  constructor(
    private adapter: OneBotV12Adapter,
    public config: OneBotV12.Config & Dict,
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
        return this.connectWs(this.config as OneBotV12.Config<'ws'>);
      case 'ws_reverse':
        return this.startWsServer(this.config as OneBotV12.Config<'ws_reverse'>);
      default:
        throw new Error(`unsupported type:${this.config.type}, supported types:'ws', 'ws_reverse'`);
    }
  }

  private dispatch(message: MessageEvent) {
    const result: OneBotV12.EventPayload | OneBotV12.ApiResult = JSON.parse(message?.toString() || 'null');
    if (!result) return;
    let temp: OneBotV12.EventPayload = result as any;
    if (temp.type === 'meta' && temp.detail_type === 'connect') this.self_id = temp.self.user_id;
    if (result.retcode !== undefined && result.echo) return this.emit('echo', result.echo, result.data);
    const event: OneBotV12.EventPayload = result as OneBotV12.EventPayload;
    this.logger.debug('receive event', event);
    if (event.type === 'message') {
      if (event.detail_type === 'guild') {
        this.logger.info(`recv [${event.detail_type} ${event.guild_id}/${event.channel_id}]: ${event.raw_message}`);
      } else {
        this.logger.info(`recv [${event.detail_type} ${event.group_id || event.user_id}]: ${event.raw_message}`);
      }
    }
    this.emit(event.type, event);
  }

  private startWsServer(cfg: OneBotV12.Config<'ws_reverse'>) {
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
            this.logger.error('连接的协议不是有效的OneBotV12协议');
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

  private connectWs(cfg: OneBotV12.Config<'ws'>) {
    const config: Required<OneBotV12.ConfigMap['ws']> = {
      url: cfg.url || 'ws://127.0.0.1:6700',
      max_reconnect_count: (cfg.max_reconnect_count ||= 10),
      reconnect_interval: (cfg.reconnect_interval ||= 3000),
    };
    this.ws = new WebSocket(config.url, {
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
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
          this.connectWs(cfg);
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

  sendPayload<T extends keyof OneBotMethodsV12>(payload: {
    action: T;
    params: Parameters<OneBotMethodsV12[T]>[0];
    echo?: number | string;
  }): Promise<ReturnType<OneBotMethodsV12[T]>> {
    return new Promise<ReturnType<OneBotMethodsV12[T]>>((resolve, reject) => {
      payload.echo = payload.echo || Date.now();
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

  async sendPrivateMsg(user_id: string, message: MessageV12.Sendable, message_id?: string) {
    this.logger.info(`send [Private ${user_id}]: ${this.getBrief(message)}`);
    const result = await this.sendPayload({
      action: 'send_private_msg',
      params: { user_id, message, message_id },
    });
    if (!result.message_id) return this.logger.error(`send failed:`, result);
    return result.message_id;
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
  sendLike(user_id: string, times = 1) {
    return this.sendPayload({
      action: 'send_like',
      params: { user_id, times },
    });
  }
  getStrangerInfo(user_id: string) {
    return this.sendPayload({
      action: 'get_stranger_info',
      params: { user_id },
    });
  }
  getGroupMemberList(group_id: string) {
    return this.sendPayload({
      action: 'get_group_member_list',
      params: { group_id },
    });
  }
  setEssenceMessage(message_id: string) {
    return this.sendPayload({
      action: 'set_essence_message',
      params: { message_id },
    });
  }
  removeEssenceMessage(message_id: string) {
    return this.sendPayload({
      action: 'remove_essence_message',
      params: { message_id },
    });
  }
  setGroupBan(group_id: string, user_id: string, duration?: number) {
    return this.sendPayload({
      action: 'set_group_ban',
      params: { group_id, user_id, duration },
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
  setGroupKick(group_id: string, user_id: string, reject_add_request?: boolean) {
    return this.sendPayload({
      action: 'set_group_kick',
      params: {
        group_id,
        user_id,
        reject_add_request,
      },
    });
  }
  setGroupAdmin(group_id: string, user_id: string, enable?: boolean) {
    return this.sendPayload({
      action: 'set_group_admin',
      params: { group_id, user_id, enable },
    });
  }
  setGroupSpecialTitle(group_id: string, user_id: string, special_title?: string, duration?: number) {
    return this.sendPayload({
      action: 'set_group_special_title',
      params: { group_id, user_id, special_title, duration },
    });
  }
  sendGroupNotice(group_id: string, content: string) {
    return this.sendPayload({
      action: 'send_group_notice',
      params: { group_id, content },
    });
  }
  setGroupAnonymous(group_id: string, enable?: boolean) {
    return this.sendPayload({
      action: 'set_group_anonymous',
      params: { group_id, enable },
    });
  }
  setGroupCard(group_id: string, user_id: string, card?: string) {
    return this.sendPayload({
      action: 'set_group_card',
      params: { group_id, user_id, card },
    });
  }
  setGroupName(group_id: string, group_name: string) {
    return this.sendPayload({
      action: 'set_group_name',
      params: { group_id, group_name },
    });
  }
  sendGroupPoke(group_id: string, user_id: string) {
    return this.sendPayload({
      action: 'send_group_poke',
      params: { group_id, user_id },
    });
  }
  async sendGroupMsg(group_id: string, message: MessageV12.Sendable, message_id?: string) {
    this.logger.info(`send [Group ${group_id}]: ${this.getBrief(message)}`);
    const result = await this.sendPayload({
      action: 'send_group_msg',
      params: { group_id, message, message_id },
    });
    if (!result.message_id) return this.logger.error(`send failed:`, result);
    return result.message_id;
  }
  async sendGuildMsg(guild_id: string, channel_id: string, message: MessageV12.Sendable, message_id?: string) {
    this.logger.info(`send [Guild ${guild_id}]: ${this.getBrief(message)}`);
    const result = await this.sendPayload({
      action: 'send_guild_msg',
      params: { guild_id, channel_id, message, message_id },
    });
    if (!result.message_id) return this.logger.error(`send failed:`, result);
    return result.message_id;
  }
  getBrief(message: MessageV12.Sendable): string {
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
  getForumUrl(guild_id: string, channel_id: string, forum_id: string) {
    return this.sendPayload({
      action: 'get_forum_url',
      params: { guild_id, channel_id, forum_id },
    });
  }
}

export namespace OneBotV12 {
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
