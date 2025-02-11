import { Adapter, registerAdapter, Message, Schema, defineMetadata } from 'zhin';
import { Bot as Client, GuildMessageEvent, DirectMessageEvent } from 'ts-disc-bot';
import { formatSendable, sendableToString } from '@/utils';

defineMetadata({ name: 'discord adapter' });
const discordAdapter = registerAdapter('discord');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      discord: Client.Options;
    }
    interface Clients {
      discord: Client;
    }
  }
}
discordAdapter.schema({
  clientId: Schema.string('请输入clientId'),
  clientSecret: Schema.string('请输入clientSecret'),
  reconnect_interval: Schema.number('请输入重连间隔时间(ms)').default(3000),
  max_reconnect_count: Schema.number('请输入最大重连次数').default(10),
  heartbeat_interval: Schema.number('请输入心跳间隔时间(ms)').default(3000),
  request_timeout: Schema.number('请输入请求超时时间(ms)').default(5000),
  sandbox: Schema.boolean('是否沙箱环境').default(true),
});
type DiscordMessageEvent = GuildMessageEvent | DirectMessageEvent;
class DiscordClient extends Adapter.BaseBot<'discord'> {
  constructor(config: Adapter.BotConfig<'discord'>) {
    super(discordAdapter, config.unique_id, new Client(config));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source?: Message<'discord'> | undefined,
  ): Promise<string> {
    const msg = formatSendable(message);
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    switch (target_type) {
      case 'guild':
        return this.sendGuildMessage(target_id, msg);
      case 'direct':
        return this.sendDirectMessage(target_id, msg);
      default:
        throw new Error(`Discord适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface DiscordClient extends Client {}
const startBots = (configs: Adapter.BotConfig<'discord'>[]) => {
  for (const config of configs) {
    const bot = new DiscordClient(config) as Adapter.Bot<'discord'>;
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      discordAdapter.emit('bot-ready', bot);
    });
    discordAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<'discord'>, event: DiscordMessageEvent) => {
  const master = discordAdapter.botConfig(bot.unique_id)?.master;
  const admins = discordAdapter.botConfig(bot.unique_id)?.admins?.filter(Boolean) || [];
  const message = Message.from(discordAdapter, bot, {
    channel: `${event.message_type}:${event instanceof DirectMessageEvent ? event.user_id : event.channel_id}`,
    sender: {
      user_id: event.sender.user_id,
      user_name: event.sender.user_name,
      permissions: [
        ...(event.sender?.permissions as unknown as string[]),
        master && event.sender?.user_id === master && 'master',
        admins && admins.includes(event.sender.user_id) && 'admins',
      ].filter(Boolean) as string[],
    },
    raw_message: sendableToString(event.message).trim(),
    message_type: event.message_type,
  });
  discordAdapter.app!.emit('message', discordAdapter, bot, message);
};
const stopBots = () => {
  for (const bot of discordAdapter.bots) {
    bot.stop();
  }
};
discordAdapter.on('start', startBots);
discordAdapter.on('stop', stopBots);
