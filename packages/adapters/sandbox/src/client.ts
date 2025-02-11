import { RawData, WebSocket } from 'ws';

import { EventEmitter } from 'events';
declare module 'zhin' {
  namespace App {
    interface Adapters {
      sandbox: { path: string };
    }
    interface Clients {
      sandbox: Client;
    }
  }
}
export class Client extends EventEmitter {
  constructor(public ws: WebSocket) {
    super();
    this.ws.on('message', this.#receivePayload.bind(this));
  }
  #receivePayload(data: RawData) {
    const payload = JSON.parse(data.toString());
    switch (payload.event) {
      case 'message.group':
        return this.emit('message', {
          message_id: Date.now(),
          channel: `group:${payload.group_id}`,
          sender: {
            user_id: payload.user_id,
            user_name: payload.user_name,
            permissions: [payload.permission || 'master', ...(payload.permissions || ['admins'])],
          },
          raw_message: payload.message,
        });
      case 'message.private': {
        return this.emit('message', {
          message_id: Date.now(),
          channel: `private:${payload.user_id}`,
          sender: {
            user_id: payload.user_id,
            user_name: payload.user_name,
            permissions: [payload.permission || 'master', ...(payload.permissions || ['admins'])],
          },
          raw_message: payload.message,
        });
      }
      default:
        throw new Error(`未知事件${payload.event}`);
    }
  }
  #sendPayload(data: any) {
    this.ws.send(JSON.stringify(data));
  }
  async sendGroupMsg(group_id: string, message: string): Promise<string> {
    this.#sendPayload({
      event: 'message.group',
      data: {
        group_id,
        message,
      },
    });
    return '发送成功';
  }
  async sendPrivateMsg(user_id: string, message: string): Promise<string> {
    this.#sendPayload({
      event: 'message.private',
      data: {
        user_id,
        message,
      },
    });
    return '发送成功';
  }
}
