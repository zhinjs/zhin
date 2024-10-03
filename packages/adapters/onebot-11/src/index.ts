import { App, Adapter, Message, Schema } from 'zhin';
import '@zhinjs/plugin-http-server';
import { OneBotV11 } from '@/onebot';
import { MessageV11 } from '@/message';
export type OneBotV11Adapter = typeof oneBotV11;
const oneBotV11 = new Adapter<Adapter.Bot<OneBotV11>, MessageV11>('onebot-11');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      'onebot-11': OneBotV11.Config;
    }
  }
}
oneBotV11.schema({
  type: Schema.const('ws', '连接方式'),
  url: Schema.string('请输入服务端ws地址'),
  access_token: Schema.string('请输入access_token'),
  max_reconnect_count: Schema.number('请输入max_reconnect_count').default(10),
  reconnect_interval: Schema.number('请输入reconnect_interval').default(3000),
});
oneBotV11.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = oneBotV11.pick(bot_id);
  let msg: MessageV11.Sendable = await oneBotV11.app!.renderMessage(message as string, source);
  msg = MessageV11.formatSegments(
    msg,
    oneBotV11.botConfig(bot)?.quote_self ? Number(source?.original?.message_id) : undefined,
  );
  switch (target_type) {
    case 'group':
      return bot.sendGroupMsg(parseInt(target_id), msg);
    case 'private':
      return bot.sendPrivateMsg(parseInt(target_id), msg);
    default:
      throw new Error(`OneBotV11适配器暂不支持发送${target_type}类型的消息`);
  }
});
const startBots = (configs: App.BotConfig<'onebot-11'>[]) => {
  if (!oneBotV11.app?.server)
    throw new Error('“oneBot V11 miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new OneBotV11(oneBotV11, config, oneBotV11.app!.router) as Adapter.Bot<OneBotV11>;

    Object.defineProperties(bot, {
      unique_id: {
        value: config.unique_id,
      },
      quote_self: {
        get() {
          return oneBotV11.botConfig(bot)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return oneBotV11.botConfig(bot)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return oneBotV11.botConfig(bot)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      oneBotV11.emit('bot-ready', bot);
    });
    oneBotV11.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<OneBotV11>, event: MessageV11) => {
  const message = Message.fromEvent(oneBotV11, bot, event);
  message.raw_message = MessageV11.formatToString(event.message);
  message.message_type = event.message_type;
  message.from_id = event.message_type === 'private' ? event.user_id + '' : event.group_id + '';
  const master = oneBotV11.botConfig(bot)?.master;
  const admins = oneBotV11.botConfig(bot)?.admins.filter(Boolean) || [];
  message.sender = {
    user_id: event.sender?.user_id,
    user_name: event.sender?.nickname || '',
    permissions: [
      master && event.user_id === master && 'master',
      admins && admins.includes(event.user_id) && 'admins',
    ].filter(Boolean) as string[],
  };
  oneBotV11.app!.emit('message', oneBotV11, bot, message);
};
const stopBots = () => {
  for (const bot of oneBotV11.bots) {
    bot.stop();
  }
};

oneBotV11.on('start', startBots);
oneBotV11.on('stop', stopBots);
export default oneBotV11;
export namespace OneBotV11Adapter {
  export type Config = OneBotV11.Config[];
}
