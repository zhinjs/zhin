import { Adapter, Message } from 'zhin';
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
oneBotV11.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = oneBotV11.pick(bot_id);
  let msg: MessageV11.Sendable = await oneBotV11.app!.renderMessage(message as string, source);
  msg = MessageV11.formatSegments(msg, Number(source?.original?.message_id) || undefined);
  switch (target_type) {
    case 'group':
      return bot.sendGroupMsg(parseInt(target_id), msg);
    case 'private':
      return bot.sendPrivateMsg(parseInt(target_id), msg);
    default:
      throw new Error(`OneBotV11适配器暂不支持发送${target_type}类型的消息`);
  }
});
const initBot = (configs: Adapter.BotConfig<OneBotV11.Config>[]) => {
  if (!oneBotV11.app?.server)
    throw new Error('“oneBot V11 miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new OneBotV11(oneBotV11, config, oneBotV11.app!.router);

    Object.defineProperties(bot, {
      unique_id: {
        value: `OneBotV11:${configs.indexOf(config) + 1}`,
      },
      quote_self: {
        get() {
          return bot.self_id;
        },
      },
      forward_length: {
        value: config.forward_length,
        writable: false,
      },
      command_prefix: {
        value: config.command_prefix,
        writable: false,
      },
    });
    oneBotV11.bots.push(bot as Adapter.Bot<OneBotV11>);
  }
  oneBotV11.on('start', startBots);
  oneBotV11.on('stop', stopBots);
};
const messageHandler = (bot: Adapter.Bot<OneBotV11>, event: MessageV11) => {
  const message = Message.fromEvent(oneBotV11, bot, event);
  message.raw_message = MessageV11.formatToString(event.message);
  message.message_type = event.message_type;
  message.from_id = event.message_type === 'private' ? event.user_id + '' : event.group_id + '';
  message.sender = {
    user_id: event.user_id,
    user_name: event.nickname || '',
  };
  oneBotV11.app!.emit('message', oneBotV11, bot, message);
};
const startBots = () => {
  for (const bot of oneBotV11.bots) {
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      oneBotV11.emit('bot-ready', bot);
    });
  }
};
const stopBots = () => {
  for (const bot of oneBotV11.bots) {
    bot.stop();
  }
};
oneBotV11.on('mounted', initBot);

export default oneBotV11;
export namespace OneBotV11Adapter {
  export type Config = OneBotV11.Config[];
}
