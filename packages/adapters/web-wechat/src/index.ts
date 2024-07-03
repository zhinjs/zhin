import { App, Adapter, Message } from 'zhin';
import { Client, BaseClient, Sendable, PrivateMessageEvent, GroupMessageEvent } from 'lib-wechat';
import { formatSendable, sendableToString } from '@/utils';
type DingMsgEvent = PrivateMessageEvent | GroupMessageEvent;
const wechatAdapter = new Adapter<Adapter.Bot<Client>, DingMsgEvent>('wechat');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      wechat: BaseClient.Config;
    }
  }
}
wechatAdapter.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = wechatAdapter.pick(bot_id);
  let msg: Sendable = await wechatAdapter.app!.renderMessage(message as string, source);
  msg = formatSendable(msg);
  switch (target_type) {
    case 'group':
      return bot.sendGroupMsg(target_id, msg);
    case 'private':
      return bot.sendPrivateMsg(target_id, msg);
    default:
      throw new Error(`wechat适配器暂不支持发送${target_type}类型的消息`);
  }
});
const startBots = (configs: App.BotConfig<'wechat'>[]) => {
  for (const config of configs) {
    const bot = new Client(config) as Adapter.Bot<Client>;
    Object.defineProperties(bot, {
      unique_id: {
        value: config.unique_id,
        writable: false,
      },
      quote_self: {
        get() {
          return wechatAdapter.botConfig(bot)?.command_prefix;
        },
      },
      forward_length: {
        get() {
          return wechatAdapter.botConfig(bot)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return wechatAdapter.botConfig(bot)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      wechatAdapter.emit('bot-ready', bot);
    });
    wechatAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<Client>, event: DingMsgEvent) => {
  const message = Message.fromEvent(wechatAdapter, bot, event);
  message.raw_message = sendableToString(event.message).trim();
  message.from_id = event instanceof PrivateMessageEvent ? event.user_id : event.group_id;
  message.message_type = event.message_type;
  const master = wechatAdapter.botConfig(bot)?.master;
  const admins = wechatAdapter.botConfig(bot)?.admins;
  message.sender = {
    ...event.sender,
    permissions: [
      master && event.sender.user_id === master && 'master',
      admins && admins.includes(event.sender.user_id) && 'admins',
    ].filter(Boolean) as string[],
  };
  wechatAdapter.app!.emit('message', wechatAdapter, bot, message);
};
const stopBots = () => {
  for (const bot of wechatAdapter.bots) {
    bot.stop();
  }
};
wechatAdapter.on('start', startBots);
wechatAdapter.on('stop', stopBots);
export default wechatAdapter;
