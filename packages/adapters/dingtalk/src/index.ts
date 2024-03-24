import { Adapter, Message } from 'zhin';
import { Bot, Sendable, PrivateMessageEvent, GroupMessageEvent } from 'node-dd-bot';
import { formatSendable, sendableToString } from '@/utils';
type DingMsgEvent = PrivateMessageEvent | GroupMessageEvent;
const dingTalkAdapter = new Adapter<Adapter.Bot<Bot>, DingMsgEvent>('dingtalk');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      dingtalk: Bot.Options;
    }
  }
}
dingTalkAdapter.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = dingTalkAdapter.pick(bot_id);
  let msg: Sendable = await dingTalkAdapter.app!.renderMessage(message as string, source);
  msg = formatSendable(msg);
  switch (target_type) {
    case 'group':
      return bot.sendGroupMsg(target_id, msg);
    case 'private':
      return bot.sendPrivateMsg(target_id, msg);
    default:
      throw new Error(`Dingtalk适配器暂不支持发送${target_type}类型的消息`);
  }
});
const initBot = (configs: Adapter.Bot<Bot.Options>[]) => {
  for (const config of configs) {
    const bot = new Bot(config);
    Object.defineProperties(bot, {
      unique_id: {
        value: config.clientId,
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
      command_prefix: {
        value: config.command_prefix,
        writable: false,
      },
    });
    dingTalkAdapter.bots.push(bot as Adapter.Bot<Bot>);
  }
  dingTalkAdapter.on('start', startBots);
  dingTalkAdapter.on('stop', stopBots);
};
const messageHandler = (bot: Adapter.Bot<Bot>, event: DingMsgEvent) => {
  const message = Message.fromEvent(dingTalkAdapter, bot, event);
  message.raw_message = sendableToString(event.message).trim();
  message.from_id = event instanceof PrivateMessageEvent ? event.user_id : event.group_id;
  message.message_type = event.message_type;
  message.sender = event.sender;

  const commands = dingTalkAdapter.app!.getSupportCommands(dingTalkAdapter, bot, message);
  const matchReg = new RegExp(`^/(${commands.map(c => c.name).join('|')})`);
  if (message.raw_message.match(matchReg)) message.raw_message = message.raw_message.slice(1);
  dingTalkAdapter.app!.emit('message', dingTalkAdapter, bot, message);
};
const startBots = () => {
  for (const bot of dingTalkAdapter.bots) {
    bot.on('message', messageHandler.bind(global, bot));
    bot.start();
  }
};
const stopBots = () => {
  for (const bot of dingTalkAdapter.bots) {
    bot.stop();
  }
};
dingTalkAdapter.on('mounted', initBot);
export default dingTalkAdapter;
