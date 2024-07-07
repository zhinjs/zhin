import { Adapter, App, Message, Schema } from 'zhin';
import '@zhinjs/plugin-http-server';
import { OneBotV12 } from '@/onebot';
import { MessageV12 } from '@/message';

export type OneBotV12Adapter = typeof oneBotV12;
const oneBotV12 = new Adapter<Adapter.Bot<OneBotV12>, MessageV12>('onebot-12');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      'onebot-12': OneBotV12.Config;
    }
  }
}
oneBotV12.schema({
  type: Schema.const('ws', '连接方式'),
  url: Schema.string('请输入服务端ws地址'),
  access_token: Schema.string('请输入access_token'),
  max_reconnect_count: Schema.number('请输入max_reconnect_count').default(10),
  reconnect_interval: Schema.number('请输入reconnect_interval').default(3000),
});
oneBotV12.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = oneBotV12.pick(bot_id);
  let msg: MessageV12.Sendable = await oneBotV12.app!.renderMessage(message as string, source);
  msg = MessageV12.formatSegments(msg);
  switch (target_type) {
    case 'guild':
      const [guild_id, channel_id] = target_id.split('/');
      return bot.sendGuildMsg(guild_id, channel_id, msg, source?.original?.message_id);
    case 'group':
      return bot.sendGroupMsg(target_id, msg, source?.original?.message_id);
    case 'private':
      return bot.sendPrivateMsg(target_id, msg, source?.original?.message_id);
    default:
      throw new Error(`OneBotV12适配器暂不支持发送${target_type}类型的消息`);
  }
});
const startBots = (configs: App.BotConfig<'onebot-12'>[]) => {
  if (!oneBotV12.app?.server)
    throw new Error('“oneBot V12 miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new OneBotV12(oneBotV12, config, oneBotV12.app!.router) as Adapter.Bot<OneBotV12>;

    Object.defineProperties(bot, {
      unique_id: {
        get() {
          return config.unique_id;
        },
      },
      quote_self: {
        get() {
          return oneBotV12.botConfig(bot)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return oneBotV12.botConfig(bot)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return oneBotV12.botConfig(bot)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      oneBotV12.emit('bot-ready', bot);
    });
    oneBotV12.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<OneBotV12>, event: MessageV12) => {
  const message = Message.fromEvent(oneBotV12, bot, event);
  message.raw_message = MessageV12.formatToString(event.message);
  message.message_type = event.detail_type;
  message.from_id =
    event.detail_type === 'private'
      ? event.user_id + ''
      : event.detail_type === 'group'
      ? event.group_id + ''
      : event.guild_id + '';

  const master = bot.config?.master;
  const admins = bot.config.admins || [];
  message.sender = {
    user_id: event.sender.user_id,
    user_name: event.sender.nickname || '',
    permissions: [
      master && event.user_id === master && 'master',
      admins && admins.includes(event.user_id) && 'admins',
      ...(event.permissions || []),
    ].filter(Boolean) as string[],
  };
  oneBotV12.app!.emit('message', oneBotV12, bot, message);
};
const stopBots = () => {
  for (const bot of oneBotV12.bots) {
    bot.stop();
  }
};

oneBotV12.on('start', startBots);
oneBotV12.on('stop', stopBots);

export default oneBotV12;
export namespace OneBotV12Adapter {
  export type Config = OneBotV12.Config[];
}
