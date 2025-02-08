import { Adapter, Message, Schema, registerAdapter, defineMetadata } from 'zhin';
import '@zhinjs/plugin-http-server';
import { OneBotV12 } from '@/onebot';
import { MessageV12 } from '@/message';
defineMetadata({ name: 'OneBot 12 adapter' });
const oneBotV12Adapter = registerAdapter('onebot_12');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      onebot_12: OneBotV12.Config;
    }
    interface Bots {
      onebot_12: OneBotV12;
    }
  }
}
oneBotV12Adapter.schema({
  type: Schema.const('ws', '连接方式'),
  url: Schema.string('请输入服务端ws地址'),
  access_token: Schema.string('请输入access_token'),
  max_reconnect_count: Schema.number('请输入max_reconnect_count').default(10),
  reconnect_interval: Schema.number('请输入reconnect_interval').default(3000),
});
class OneBotClient extends Adapter.Bot<'onebot_12'> {
  constructor(config: Adapter.BotConfig<'onebot_12'>) {
    super(oneBotV12Adapter, config.unique_id, new OneBotV12(oneBotV12Adapter, config, oneBotV12Adapter.app!.router));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source: Message<'onebot_12'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const msg = MessageV12.formatSegments(message);
    switch (target_type) {
      case 'group':
        return this.sendGroupMsg(target_id, msg);
      case 'private':
        return this.sendPrivateMsg(target_id, msg);
      default:
        throw new Error(`OneBotV12适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface OneBotClient extends OneBotV12 {}
const startBots = (configs: Adapter.BotConfig<'onebot_12'>[]) => {
  if (!oneBotV12Adapter.app?.server)
    throw new Error('“oneBot V12 miss require service “http”, maybe you need install “ @zhinjs/plugin-http-server ”');

  for (const config of configs) {
    const bot = new OneBotClient(config);
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      oneBotV12Adapter.emit('bot-ready', bot);
    });
    oneBotV12Adapter.bots.push(bot);
  }
};
const messageHandler = (bot: OneBotClient, event: MessageV12) => {
  const master = bot.config?.master;
  const admins = bot.config.admins?.filter(Boolean) || [];
  const message = Message.from(oneBotV12Adapter, bot, {
    message_id: event.message_id,
    channel: `${event.detail_type}:${event.group_id || event.user_id || event.guild_id}`,
    message_type: event.detail_type,
    sender: {
      user_id: event.sender.user_id,
      user_name: event.sender.nickname || '',
      permissions: [
        master && event.sender.user_id === master && 'master',
        admins && admins.includes(event.sender.user_id) && 'admins',
      ].filter(Boolean) as string[],
    },
    raw_message: MessageV12.formatToString(event.message),
  });
  oneBotV12Adapter.app!.emit('message', oneBotV12Adapter, bot, message);
};
const stopBots = () => {
  for (const bot of oneBotV12Adapter.bots) {
    bot.internal.stop();
  }
};
oneBotV12Adapter.on('start', startBots);
oneBotV12Adapter.on('stop', stopBots);

export namespace OneBotV12Adapter {
  export type Config = OneBotV12.Config[];
}
