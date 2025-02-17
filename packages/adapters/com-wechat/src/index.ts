import { Adapter, Message, Schema, registerAdapter, defineMetadata } from 'zhin';
import '@zhinjs/plugin-http-server';
import { Client } from '@/client';
defineMetadata({ name: 'com wechat adapter' });
import { Message as ClientMessage } from '@/message';
export type ComWechatAdapter = typeof adapter;
const adapter = registerAdapter('com-wechat');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      'com-wechat': Client.Config;
    }
    interface Clients {
      'com-wechat': Client;
    }
  }
}
adapter.schema({
  type: Schema.const('ws', '连接方式'),
  url: Schema.string('请输入服务端ws地址'),
  access_token: Schema.string('请输入access_token'),
  max_reconnect_count: Schema.number('请输入max_reconnect_count').default(10),
  reconnect_interval: Schema.number('请输入reconnect_interval').default(3000),
});
class WechatClient extends Adapter.BaseBot<'com-wechat'> {
  constructor(config: Adapter.BotConfig<'com-wechat'>) {
    super(adapter, config.unique_id, new Client(adapter, config, adapter.app!.router));
    this.on('ready', () => {
      this.adapter.emit('bot-ready', this);
    });
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source: Message<'com-wechat'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const msg = ClientMessage.formatSegments(message);
    switch (target_type) {
      case 'group':
        return this.sendGroupMsg(target_id, msg);
      case 'private':
        return this.sendPrivateMsg(target_id, msg);
      default:
        throw new Error(`com wechat 适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface WechatClient extends Client {}
const startBots = (configs: Adapter.BotConfig<'com-wechat'>[]) => {
  if (!adapter.app?.server)
    throw new Error('“com-wechat miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new WechatClient(config) as Adapter.Bot<'com-wechat'>;
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      adapter.emit('bot-ready', bot);
    });
    adapter.bots.push(bot);
  }
};
const messageHandler = (bot: WechatClient, event: ClientMessage) => {
  const message = Message.from(adapter, bot, {
    channel: `${event.detail_type}:${event.user_id}`,
    sender: {
      user_id: event.user_id,
      user_name: event.nickname || '',
      permissions: [...(event.permissions || [])].filter(Boolean) as string[],
    },
    raw_message: ClientMessage.formatToString(event.message),
    message_type: event.detail_type as any,
  });
  adapter.app!.emit('message', message);
};
const stopBots = () => {
  for (const bot of adapter.bots) {
    bot.stop();
  }
};

adapter.on('start', startBots);
adapter.on('stop', stopBots);
export namespace ClientAdapter {
  export type Config = Client.Config[];
}
