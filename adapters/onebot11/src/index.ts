import WebSocket, {WebSocketServer} from 'ws';
import {EventEmitter} from "events";
import {
  Bot,
  Plugin,
  Adapter,
  BotConfig,
  Message,
  registerAdapter,
  User,
  Group,
  MessageSegment,
  SendOptions,
  MessageType, segment, useContext, SendContent
} from 'zhin.js';
import type {Router} from '@zhin.js/http'
import {IncomingMessage} from "http";
import {clearInterval} from "node:timers";

declare module 'zhin.js'{
  interface RegisteredAdapters{
    'onebot11':Adapter<OneBot11WsClient>
    'onebot11.wss':Adapter<OneBot11WsServer>
  }
}
// ============================================================================
// OneBot11 配置和类型
// ============================================================================

export interface OneBot11Config extends BotConfig {
  context: 'onebot11';
  type:string
  access_token?: string;
}
export interface OneBot11WsClientConfig extends OneBot11Config{
  type:'ws'
  url: string;
  reconnect_interval?: number;
  heartbeat_interval?: number;
}
export interface OneBot11WsServerConfig extends OneBot11Config{
  type:'ws_reverse'
  path:string
  heartbeat_interval?: number;
}
export interface OneBot11HTTPConfig extends OneBot11Config{
  type:'http_sse'
  port:number
  path:string
}

interface OneBot11Message {
  post_type: string;
  self_id:string
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

// ============================================================================
// OneBot11 适配器实现
// ============================================================================

export class OneBot11WsClient extends EventEmitter implements Bot<OneBot11Message,OneBot11WsClientConfig> {
  $connected?:boolean
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(public plugin:Plugin,public $config: OneBot11WsClientConfig) {
    super();
    this.$connected=false
  }


  async $connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let wsUrl = this.$config.url;
      const headers: Record<string, string> = {};

      if (this.$config.access_token) {
        headers['Authorization'] = `Bearer ${this.$config.access_token}`;
      }
      this.ws = new WebSocket(wsUrl,{headers});

      this.ws.on('open', () => {
        this.$connected=true;
        if(!this.$config.access_token) this.plugin.logger.warn(`missing 'access_token', your OneBot protocol is not safely`)
        this.startHeartbeat();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message);
        } catch (error) {
          this.emit('error',error)
        }
      });

      this.ws.on('close', (code,reason) => {
        this.$connected=false
        reject({code,reason})
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
  $formatMessage(onebotMsg: OneBot11Message){
    const message=Message.from(onebotMsg,{
      $id: onebotMsg.message_id.toString(),
      $adapter:'onebot11',
      $bot:`${this.$config.name}`,
      $sender:{
        id:onebotMsg.user_id.toString(),
        name:onebotMsg.user_id.toString()
      },
      $channel:{
        id: (onebotMsg.group_id || onebotMsg.user_id).toString(),
        type:onebotMsg.group_id?'group':'private'
      },
      $content: onebotMsg.message,
      $raw: onebotMsg.raw_message,
      $timestamp: onebotMsg.time,
      $reply:async (content: MessageSegment[], quote?: boolean|string):Promise<void>=> {
        if(quote) content.unshift({type:'reply',data:{message_id:message.$id}})
        this.plugin.dispatch('message.send',{
          ...message.$channel,
          context:'onebot11',
          bot:`${this.$config.name}`,
          content
        })
      }
    })
    return message
  }

  async $sendMessage(options: SendOptions): Promise<void> {
    options=await this.plugin.app.handleBeforeSend(options)
    const messageData: any = {
      message: options.content
    };
    if (options.type==='group') {
      await this.callApi('send_group_msg', {
        group_id: parseInt(options.id),
        ...messageData
      });
      this.plugin.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
    } else if (options.type==='private') {
      await this.callApi('send_private_msg', {
        user_id: parseInt(options.id),
        ...messageData
      });
      this.plugin.logger.info(`send ${options.type}(${options.id}):${segment.raw(options.content)}`)
    } else {
      throw new Error('Either group_id or user_id must be provided');
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
    this.plugin.dispatch('message.receive',message)
    this.plugin.logger.info(`recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`)
    this.plugin.dispatch(`message.${message.$channel.type}.receive`,message)
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
        this.emit('error',new Error(`Reconnection failed: ${error}`));
        this.scheduleReconnect();
      }
    }, interval);
  }
}
export class OneBot11WsServer extends EventEmitter implements Bot<OneBot11Message,OneBot11WsServerConfig> {
  $connected?:boolean
  #wss?:WebSocketServer
  #clientMap:Map<string,WebSocket>=new Map<string,WebSocket>()
  private heartbeatTimer?: NodeJS.Timeout;
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(public plugin:Plugin,public router:Router,public $config: OneBot11WsServerConfig) {
    super();
    this.$connected=false
  }
  async $connect(): Promise<void> {
    if(!this.$config.access_token) this.plugin.logger.warn(`missing 'access_token', your OneBot protocol is not safely`)
    this.#wss=this.router.ws(this.$config.path,{verifyClient:(info:{ origin: string; secure: boolean; req: IncomingMessage })=>{
        const {
          req: { headers },
        } = info;
        const authorization = headers['authorization'] || '';
        if (this.$config.access_token && authorization !== `Bearer ${this.$config.access_token}`) {
          this.plugin.logger.error('鉴权失败');
          return false;
        }
        return true;
      }})
    this.$connected=true;
    this.plugin.logger.info(`ws server start at path:${this.$config.path}`)
    this.#wss.on('connection', (client,req) => {
      this.startHeartbeat();
      this.plugin.logger.info(`已连接到协议端：${req.socket.remoteAddress}`);
      client.on('error', err => {
        this.plugin.logger.error('连接出错：', err);
      });
      client.on('close', code => {
        this.plugin.logger.error(`与连接端(${req.socket.remoteAddress})断开，错误码：${code}`);
        for(const [key,value] of this.#clientMap){
          if(client===value) this.#clientMap.delete(key)
        }
      });
      client.on('message',(data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(client,message);
        } catch (error) {
          this.emit('error',error)
        }
      })
    });
  }

  async $disconnect(): Promise<void> {
    this.#wss?.close();
    if(this.heartbeatTimer){
      clearInterval(this.heartbeatTimer)
      delete this.heartbeatTimer;
    }
  }
  $formatMessage(onebotMsg: OneBot11Message){
    const message=Message.from(onebotMsg,{
      $id: onebotMsg.message_id.toString(),
      $adapter:'onebot11',
      $bot:`${this.$config.name}`,
      $sender:{
        id:onebotMsg.user_id.toString(),
        name:onebotMsg.user_id.toString()
      },
      $channel:{
        id:[onebotMsg.self_id,(onebotMsg.group_id||onebotMsg.user_id)].join(':'),
        type:onebotMsg.group_id?'group':'private'
      },
      $content: onebotMsg.message,
      $raw: onebotMsg.raw_message,
      $timestamp: onebotMsg.time,
      $reply:async (content: SendContent, quote?: boolean|string):Promise<void>=> {
        if(!Array.isArray(content)) content=[content];
        if(quote) content.unshift({type:'reply',data:{message_id:message.$id}})
        this.plugin.dispatch('message.send',{
          ...message.$channel,
          context:'onebot11',
          bot:`${this.$config.name}`,
          content
        })
      }
    })
    return message
  }

  async $sendMessage(options: SendOptions): Promise<void> {
    options=await this.plugin.app.handleBeforeSend(options)
    const messageData: any = {
      message: options.content
    };
    if (options.type==='group') {
      const [self_id,id]=options.id.split(':')
      await this.callApi(self_id,'send_group_msg', {
        group_id: parseInt(id),
        ...messageData
      });
      this.plugin.logger.info(`send ${options.type}(${id}):${segment.raw(options.content)}`)
    } else if (options.type==='private') {
      const [self_id,id]=options.id.split(':')
      await this.callApi(self_id,'send_private_msg', {
        user_id: parseInt(id),
        ...messageData
      });
      this.plugin.logger.info(`send ${options.type}(${id}):${segment.raw(options.content)}`)
    } else {
      throw new Error('Either group_id or user_id must be provided');
    }
  }
  private async callApi(self_id:string,action: string, params: any = {}): Promise<any> {
    const client=this.#clientMap.get(self_id)
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

  private handleWebSocketMessage(client:WebSocket,message: any): void {
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
    switch (message.post_type){
      case 'message':
        return this.handleMessage(message);
      case 'meta_event':
        return this.handleMetaEvent(client,message)
    }
    // 处理事件消息
    if (message.post_type === 'message') {
    } else if (message.post_type === 'meta_event' && message.meta_event_type === 'heartbeat') {
      // 心跳消息，暂时忽略
    }
  }
  private handleMetaEvent(client:WebSocket,message:any){
    switch (message.sub_type){
      case 'heartbeat':
        break;
      case 'connect':
        this.#clientMap.set(message.self_id,client);
        this.plugin.logger.info(`client ${message.self_id} of ${this.$config.name} by ${this.$config.context} connected`)
        break;
    }
  }
  private handleMessage(onebotMsg: OneBot11Message): void {
    const message = this.$formatMessage(onebotMsg);
    this.plugin.dispatch('message.receive',message)
    this.plugin.logger.info(`recv ${message.$channel.type}(${onebotMsg.group_id||onebotMsg.user_id}):${segment.raw(message.$content)}`)
    this.plugin.dispatch(`message.${message.$channel.type}.receive`,message)
  }

  private startHeartbeat(): void {
    const interval = this.$config.heartbeat_interval || 30000;
    this.heartbeatTimer = setInterval(() => {
      for(const client of this.#wss?.clients||[]){
        if (client && client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, interval);
  }
}
registerAdapter(new Adapter('onebot11',OneBot11WsClient))
useContext('router',(router)=>{
  registerAdapter(new Adapter('onebot11.wss',(p,c:OneBot11WsServerConfig)=>new OneBot11WsServer(p,router,c)));
})