import { Adapter, registerAdapter, Message, defineMetadata } from 'zhin';
import { Client, BaseClient, PrivateMessageEvent, GroupMessageEvent } from 'web-wechat';
import { formatSendable, sendableToString } from '@/utils';
type DingMsgEvent = PrivateMessageEvent | GroupMessageEvent;
defineMetadata({ name: 'Web Wechat adapter' });
const wechatAdapter = registerAdapter('web-wechat');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      'web-wechat': BaseClient.Config;
    }
    interface Clients {
      'web-wechat': Client;
    }
  }
}
class WechatClient extends Adapter.BaseBot<'web-wechat'> {
  constructor(config: Adapter.BotConfig<'web-wechat'>) {
    super(wechatAdapter, config.unique_id, new Client(config));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source?: Message<'web-wechat'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const msg = formatSendable(message);
    switch (target_type) {
      case 'group':
        return (await this.sendGroupMsg(target_id, msg)) as string;
      case 'private':
        return (await this.sendPrivateMsg(target_id, msg)) as string;
      default:
        throw new Error(`wechat适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface WechatClient extends Client {}
const startBots = (configs: Adapter.BotConfig<'web-wechat'>[]) => {
  for (const config of configs) {
    const bot = new WechatClient(config) as Adapter.Bot<'web-wechat'>;
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      wechatAdapter.emit('bot-ready', bot);
    });
    wechatAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: WechatClient, event: DingMsgEvent) => {
  const message = Message.from(wechatAdapter, bot, {
    channel: `${event.message_type}:${event instanceof PrivateMessageEvent ? event.user_id : event.group_id}`,
    message_id: event.message_id,
    raw_message: sendableToString(event.message).trim(),
    message_type: event.message_type,
    sender: {
      ...event.sender,
      permissions: [],
    },
  });
  wechatAdapter.app!.emit('message', message);
};
const stopBots = () => {
  for (const bot of wechatAdapter.bots) {
    bot.stop();
  }
};
wechatAdapter.on('start', startBots);
wechatAdapter.on('stop', stopBots);
