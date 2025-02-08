import { App, Adapter, registerAdapter, Message, Schema, defineMetadata } from 'zhin';
import '@zhinjs/plugin-http-server';
import { OneBotV11 } from '@/onebot';
import { MessageV11 } from '@/message';
defineMetadata({ name: 'OneBot 11 adapter' });
const oneBotV11 = registerAdapter('onebot_11');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      onebot_11: OneBotV11.Config;
    }
    interface Bots {
      onebot_11: OneBotV11;
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
class OneBotClient extends Adapter.Bot<'onebot_11'> {
  constructor(config: Adapter.BotConfig<'onebot_11'>) {
    super(oneBotV11, config.unique_id, new OneBotV11(oneBotV11, config, oneBotV11.app!.router));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source: Message<'onebot_11'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const msg = MessageV11.formatSegments(message);
    switch (target_type) {
      case 'group':
        return this.sendGroupMsg(Number(target_id), msg);
      case 'private':
        return this.sendPrivateMsg(Number(target_id), msg);
      default:
        throw new Error(`OneBotV11适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface OneBotClient extends OneBotV11 {}
const startBots = (configs: Adapter.BotConfig<'onebot_11'>[]) => {
  if (!oneBotV11.app?.server)
    throw new Error('“oneBot V11 miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new OneBotClient(config);
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      oneBotV11.emit('bot-ready', bot);
    });
    oneBotV11.bots.push(bot);
  }
};
const messageHandler = (bot: OneBotClient, event: MessageV11) => {
  const master = oneBotV11.botConfig(bot.unique_id)?.master;
  const admins = oneBotV11.botConfig(bot.unique_id)?.admins?.filter(Boolean) || [];
  const message = Message.from(oneBotV11, bot, {
    raw_message: MessageV11.formatToString(event.message),
    channel: `${event.message_type}:${event.message_type === 'private' ? event.user_id : event.group_id}`,
    sender: {
      user_id: event.sender?.user_id,
      user_name: event.sender?.nickname || '',
      permissions: [
        master && event.user_id === master && 'master',
        admins && admins.includes(event.user_id) && 'admins',
      ].filter(Boolean) as string[],
    },
    message_type: event.message_type,
  });
  oneBotV11.app!.emit('message', oneBotV11, bot, message);
};
const stopBots = () => {
  for (const bot of oneBotV11.bots) {
    bot.internal.stop();
  }
};

oneBotV11.on('start', startBots);
oneBotV11.on('stop', stopBots);
export namespace OneBotV11Adapter {
  export type Config = OneBotV11.Config[];
}
