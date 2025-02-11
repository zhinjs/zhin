import { Adapter, Message, Schema, registerAdapter, defineMetadata } from 'zhin';
import { Bot as Client, PrivateMessageEvent, GroupMessageEvent } from 'node-dd-bot';
import { formatSendable, sendableToString } from '@/utils';
type DingMsgEvent = PrivateMessageEvent | GroupMessageEvent;
defineMetadata({ name: 'dingTalk adapter' });
const dingTalkAdapter = registerAdapter('dingtalk');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      dingtalk: Client.Options;
    }
    interface Clients {
      dingtalk: Client;
    }
  }
}
dingTalkAdapter.schema({
  clientId: Schema.string('请输入clientId'),
  clientSecret: Schema.string('请输入clientSecret'),
  reconnect_interval: Schema.number('请输入重连间隔时间(ms)').default(3000),
  max_reconnect_count: Schema.number('请输入最大重连次数').default(10),
  heartbeat_interval: Schema.number('请输入心跳间隔时间(ms)').default(3000),
  request_timeout: Schema.number('请输入请求超时时间(ms)').default(5000),
  sandbox: Schema.boolean('是否沙箱环境').default(true),
});
class DingTalkClient extends Adapter.BaseBot<'dingtalk'> {
  constructor(config: Adapter.BotConfig<'dingtalk'>) {
    super(dingTalkAdapter, config.unique_id, new Client(config));
  }
  handleSendMessage(
    channel: Message.Channel,
    message: string,
    source: Message<'dingtalk'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const msg = formatSendable(message);
    switch (target_type) {
      case 'group':
        return this.sendGroupMsg(target_id, msg);
      case 'private':
        return this.sendPrivateMsg(target_id, msg);
      default:
        throw new Error(`Dingtalk适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface DingTalkClient extends Client {}
const startBots = (configs: Adapter.BotConfig<'dingtalk'>[]) => {
  for (const config of configs) {
    const bot = new DingTalkClient(config) as Adapter.Bot<'dingtalk'>;
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      dingTalkAdapter.emit('bot-ready', bot);
    });
    dingTalkAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<'dingtalk'>, event: DingMsgEvent) => {
  const master = dingTalkAdapter.botConfig(bot.unique_id)?.master;
  const admins = dingTalkAdapter.botConfig(bot.unique_id)?.admins?.filter(Boolean) || [];
  const message = Message.from(dingTalkAdapter, bot, {
    raw_message: sendableToString(event.message).trim(),
    channel: `${event.message_type}:${event instanceof PrivateMessageEvent ? event.user_id : event.group_id}`,
    message_type: event.message_type,
    sender: {
      ...event.sender,
      permissions: [
        master && event.user_id === master && 'master',
        admins && admins.includes(event.user_id) && 'admins',
      ].filter(Boolean) as string[],
    },
  });
  dingTalkAdapter.app!.emit('message', dingTalkAdapter, bot, message);
};
const stopBots = () => {
  for (const bot of dingTalkAdapter.bots) {
    bot.stop();
  }
};
dingTalkAdapter.on('start', startBots);
dingTalkAdapter.on('stop', stopBots);
