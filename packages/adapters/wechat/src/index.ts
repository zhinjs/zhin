import { Adapter, Message } from 'zhin';
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
const initBot = (configs: Adapter.BotConfig<BaseClient.Config>[]) => {
  for (const config of configs) {
    const bot = new Client(config);
    Object.defineProperties(bot, {
      unique_id: {
        value: bot.uin + '',
        writable: false,
      },
      quote_self: {
        value: config.quote_self,
        writable: false,
      },
      forward_length: {
        value: config.forward_length,
        writable: false,
      },
    });
    wechatAdapter.bots.push(bot as Adapter.Bot<Client>);
  }
  wechatAdapter.on('start', startBots);
  wechatAdapter.on('stop', stopBots);
};
const messageHandler = (bot: Adapter.Bot<Client>, event: DingMsgEvent) => {
  const message = Message.fromEvent(wechatAdapter, bot, event);
  message.raw_message = sendableToString(event.message).trim();
  message.from_id = event instanceof PrivateMessageEvent ? event.user_id : event.group_id;
  message.message_type = event.message_type;
  message.sender = event.sender;

  const commands = wechatAdapter.app!.getSupportCommands(wechatAdapter, bot, message);
  const matchReg = new RegExp(`^/(${commands.map(c => c.name).join('|')})`);
  if (message.raw_message.match(matchReg)) message.raw_message = message.raw_message.slice(1);
  wechatAdapter.app!.emit('message', wechatAdapter, bot, message);
};
const startBots = () => {
  for (const bot of wechatAdapter.bots) {
    bot.on('message', messageHandler.bind(global, bot));
    bot.start();
  }
};
const stopBots = () => {
  for (const bot of wechatAdapter.bots) {
    bot.stop();
  }
};
wechatAdapter.on('mounted', initBot);
export default wechatAdapter;
