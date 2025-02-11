import path from 'path';
import {
  Adapter,
  defineMetadata,
  waitServices,
  inject,
  logger,
  Message,
  registerAdapter,
  onUnmount,
  MessageBase,
  App,
} from 'zhin';
import type {} from '@zhinjs/plugin-http-server';
import type {} from '@zhinjs/web';
import { Client } from '@/client';
import { WebSocket, WebSocketServer } from 'ws';
defineMetadata({ name: 'Sandbox adapter' });
const sandboxAdapter = registerAdapter('sandbox');
class SandboxClient extends Adapter.BaseBot<'sandbox'> {
  constructor(adapter: Adapter<'sandbox'>, ws: WebSocket) {
    super(adapter, ws.url, new Client(ws));
  }
  async handleSendMessage(channel: Message.Channel, message: string): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    switch (target_type) {
      case 'group':
        return this.sendGroupMsg(target_id, message);
      case 'private':
        return this.sendPrivateMsg(target_id, message);
      default:
        throw new Error(`Sandbox适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface SandboxClient extends Client {}
let server: WebSocketServer | null = null;

const startSandbox = (app: App, server: WebSocketServer) => {
  server.on('connection', ws => {
    const client = new SandboxClient(sandboxAdapter, ws);
    client.on('message', (message: MessageBase) => {
      app.emit('message', Message.from(sandboxAdapter, client, message));
    });
    sandboxAdapter.bots.push(client);
  });
  server.on('close', () => {
    sandboxAdapter.bots = [];
  });
};
onUnmount(() => {
  server?.close();
  server = null;
});
waitServices('router', async app => {
  logger.info('add sandbox ws service');
  startSandbox(app, (server = inject('router').ws('/sandbox')));
});
waitServices('web', async () => {
  logger.info('add web entry');
  inject('web').addEntry(path.resolve(__dirname, '../client/index.ts'));
});
