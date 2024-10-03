import { Adapter, App, Message, Schema } from 'zhin';
import '@zhinjs/plugin-http-server';
import { Client } from '@/client';
import { Message as ClientMessage } from '@/message';
export type ComWechatAdapter = typeof adapter;
const adapter = new Adapter<Adapter.Bot<Client>, ClientMessage>('com-wechat');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      'com-wechat': Client.Config;
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
adapter.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = adapter.pick(bot_id);
  let msg: ClientMessage.Sendable = await adapter.app!.renderMessage(message as string, source);
  msg = ClientMessage.formatSegments(msg);
  switch (target_type) {
    case 'group':
      return bot.sendGroupMsg(target_id, msg);
    case 'private':
      return bot.sendPrivateMsg(target_id, msg);
    default:
      throw new Error(`com wechat 适配器暂不支持发送${target_type}类型的消息`);
  }
});
const startBots = (configs: App.BotConfig<'com-wechat'>[]) => {
  if (!adapter.app?.server)
    throw new Error('“com-wechat miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new Client(adapter, config, adapter.app!.router) as Adapter.Bot<Client>;

    Object.defineProperties(bot, {
      unique_id: {
        get() {
          return config.unique_id;
        },
      },
      quote_self: {
        get() {
          return adapter.botConfig(bot)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return adapter.botConfig(bot)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return adapter.botConfig(bot)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      adapter.emit('bot-ready', bot);
    });
    adapter.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<Client>, event: ClientMessage) => {
  const message = Message.fromEvent(adapter, bot, event);
  message.raw_message = ClientMessage.formatToString(event.message);
  message.message_type = event.detail_type;
  message.from_id =
    event.detail_type === 'private'
      ? event.user_id + ''
      : event.detail_type === 'group'
      ? event.group_id + ''
      : event.guild_id + '';

  const master = bot.config?.master;
  const admins = bot.config.admins?.filter(Boolean) || [];
  message.sender = {
    user_id: event.user_id,
    user_name: event.nickname || '',
    permissions: [
      master && event.user_id === master && 'master',
      admins && admins.includes(event.user_id) && 'admins',
      ...(event.permissions || []),
    ].filter(Boolean) as string[],
  };
  adapter.app!.emit('message', adapter, bot, message);
};
const stopBots = () => {
  for (const bot of adapter.bots) {
    bot.stop();
  }
};

adapter.on('start', startBots);
adapter.on('stop', stopBots);

export default adapter;
export namespace ClientAdapter {
  export type Config = Client.Config[];
}
