import { App, Adapter, Message, Schema } from 'zhin';
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
dingTalkAdapter.schema({
  clientId: Schema.string('请输入clientId'),
  clientSecret: Schema.string('请输入clientSecret'),
  reconnect_interval: Schema.number('请输入重连间隔时间(ms)').default(3000),
  max_reconnect_count: Schema.number('请输入最大重连次数').default(10),
  heartbeat_interval: Schema.number('请输入心跳间隔时间(ms)').default(3000),
  request_timeout: Schema.number('请输入请求超时时间(ms)').default(5000),
  sandbox: Schema.boolean('是否沙箱环境').default(true),
});
const startBots = (configs: App.BotConfig<'dingtalk'>[]) => {
  for (const config of configs) {
    const bot = new Bot(config) as Adapter.Bot<Bot>;
    Object.defineProperties(bot, {
      unique_id: {
        value: config.unique_id,
        writable: false,
      },
      quote_self: {
        get() {
          return dingTalkAdapter.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return dingTalkAdapter.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return dingTalkAdapter.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      dingTalkAdapter.emit('bot-ready', bot);
    });
    dingTalkAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<Bot>, event: DingMsgEvent) => {
  const message = Message.fromEvent(dingTalkAdapter, bot, event);
  message.raw_message = sendableToString(event.message).trim();
  message.from_id = event instanceof PrivateMessageEvent ? event.user_id : event.group_id;
  message.message_type = event.message_type;
  const master = dingTalkAdapter.botConfig(bot)?.master;
  const admins = dingTalkAdapter.botConfig(bot)?.admins?.filter(Boolean) || [];
  message.sender = {
    ...event.sender,
    permissions: [
      master && event.user_id === master && 'master',
      admins && admins.includes(event.user_id) && 'admins',
    ].filter(Boolean) as string[],
  };
  dingTalkAdapter.app!.emit('message', dingTalkAdapter, bot, message);
};
const stopBots = () => {
  for (const bot of dingTalkAdapter.bots) {
    bot.stop();
  }
};
dingTalkAdapter.on('start', startBots);
dingTalkAdapter.on('stop', stopBots);
export default dingTalkAdapter;
