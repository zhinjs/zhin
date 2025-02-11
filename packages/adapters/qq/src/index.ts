import { Adapter, defineMetadata, Message, registerAdapter, Schema } from 'zhin';
import { formatSendable, sendableToString } from './utils';
import {
  Bot as Client,
  PrivateMessageEvent,
  GroupMessageEvent,
  GuildMessageEvent,
  Intent,
  Quotable,
} from 'qq-official-bot';
type QQMessageEvent = PrivateMessageEvent | GroupMessageEvent | GuildMessageEvent;
defineMetadata({ name: 'QQ adapter' });
const qqAdapter = registerAdapter('qq');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      qq: QQConfig;
    }
    interface Clients {
      qq: Client;
    }
  }
}
qqAdapter.schema({
  appid: Schema.string('请输入appid').required(),
  secret: Schema.string('请输入secret').required(),
  group: Schema.boolean('是否拥有群聊能力'),
  public: Schema.boolean('是否公域机器人'),
  sandbox: Schema.boolean('是否开启杀箱模式'),
});
type QQConfig = {
  appid: string;
  token: string;
  secret: string;
  private?: boolean;
  group?: boolean;
  removeAt?: boolean;
  sandbox?: boolean;
  timeout?: number;
  public?: boolean;
};
class QQClient extends Adapter.BaseBot<'qq'> {
  constructor({ private: isPrivate, group, public: isPublic, ...config }: Adapter.BotConfig<'qq'>) {
    super(
      qqAdapter,
      config.unique_id,
      new Client({
        logLevel: qqAdapter.app!.config.log_level as any,
        ...config,
        mode: 'websocket',
        intents: [
          group && 'GROUP_AT_MESSAGE_CREATE',
          isPrivate && 'C2C_MESSAGE_CREATE',
          'DIRECT_MESSAGE',
          !isPublic && 'GUILD_MESSAGES',
          'GUILDS',
          'GUILD_MEMBERS',
          'GUILD_MESSAGE_REACTIONS',
          'DIRECT_MESSAGE',
          'INTERACTION',
          isPublic && 'PUBLIC_GUILD_MESSAGES',
        ].filter(Boolean) as Intent[],
      }),
    );
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source?: Message<'qq'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const msg = formatSendable(message);
    const quote: Quotable | undefined = source ? (source.quote as any) : undefined;
    switch (target_type) {
      case 'group':
        await this.sendGroupMessage(target_id, msg, quote);
        return '';
      case 'private':
        const [sub_type, user_id] = target_id.split(':');
        if (sub_type === 'friend') {
          await this.sendPrivateMessage(user_id, msg, quote);
          return '';
        }
        await this.sendDirectMessage(user_id, msg, quote);
        return '';
      case 'direct':
        await this.sendDirectMessage(target_id, msg, quote);
        return '';
      case 'guild':
        await this.sendGuildMessage(target_id, msg, quote);
        return '';
      default:
        throw new Error(`QQ适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface QQClient extends Client {}
const startBots = (configs: Adapter.BotConfig<'qq'>[]) => {
  for (const config of configs) {
    const bot = new QQClient(config) as Adapter.Bot<'qq'>;
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      qqAdapter.emit('bot-ready', bot);
    });
    qqAdapter.bots.push(bot);
  }
};
const createChannel = (event: QQMessageEvent): Message.Channel => {
  switch (event.message_type) {
    case 'private':
      return `private:${event.sub_type}:${event.guild_id || event.user_id}`;
    case 'group':
      return `group:${event.group_id}`;
    case 'guild':
      return `guild:${event.channel_id}`;
    default:
      throw new Error(`未知的消息类型: ${event.message_type}`);
  }
};
const messageHandler = (bot: QQClient, event: QQMessageEvent) => {
  const master = qqAdapter.botConfig(bot.unique_id)?.master;
  const admins = qqAdapter.botConfig(bot.unique_id)?.admins?.filter(Boolean) || [];
  const message = Message.from(qqAdapter, bot, {
    raw_message: sendableToString(event.message).trim(),
    message_type: event.message_type,
    channel: createChannel(event),
    sender: {
      ...event.sender,
      permissions: [
        master && event.user_id === master && 'master',
        admins && admins.includes(event.user_id) && 'admins',
        ...event.sender?.permissions,
      ].filter(Boolean) as string[],
    },
  });
  if (event.source) {
    message.quote = event.source;
  }
  qqAdapter.app!.emit('message', qqAdapter, bot, message);
};
const stopBots = () => {
  for (const bot of qqAdapter.bots) {
    bot.stop();
  }
};

qqAdapter.on('start', startBots);
qqAdapter.on('stop', stopBots);
