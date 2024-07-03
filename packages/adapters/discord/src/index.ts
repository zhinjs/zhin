import { Adapter, App, Message } from 'zhin';
import { Bot, GuildMessageEvent, DirectMessageEvent, Sendable } from 'ts-disc-bot';
import { formatSendable, sendableToString } from '@/utils';

const discordAdapter = new Adapter<Adapter.Bot<Bot>>('discord');
declare module 'zhin' {
  namespace App {
    interface Adapters {
      discord: Bot.Options;
    }
  }
}
discordAdapter
  .schema('clientId', {
    method: 'text',
    args: ['请输入clientId'],
  })
  .schema('clientSecret', {
    method: 'text',
    args: ['请输入clientSecret'],
  })
  .schema('reconnect_interval', {
    method: 'number',
    args: ['请输入reconnect_interval', undefined, '3000'],
  })
  .schema('max_reconnect_count', {
    method: 'number',
    args: ['请输入max_reconnect_count', undefined, '10'],
  })
  .schema('heartbeat_interval', {
    method: 'number',
    args: ['请输入heartbeat_interval', undefined, '3000'],
  })
  .schema('request_timeout', {
    method: 'number',
    args: ['请输入request_timeout', undefined, '5000'],
  })
  .schema('sandbox', {
    method: 'confirm',
    args: ['请输入sandbox', undefined, 'true'],
  });
discordAdapter.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = discordAdapter.pick(bot_id);
  let msg: Sendable = await discordAdapter.app!.renderMessage(message as string, source);
  msg = formatSendable(msg);
  switch (target_type) {
    case 'guild':
      return bot.sendGuildMessage(target_id, msg);
    case 'direct':
      return bot.sendDirectMessage(target_id, msg);
    default:
      throw new Error(`Discord适配器暂不支持发送${target_type}类型的消息`);
  }
});
type DingTalkMessageEvent = GuildMessageEvent | DirectMessageEvent;

const startBots = (configs: App.BotConfig<'discord'>[]) => {
  for (const config of configs) {
    const bot = new Bot(config) as Adapter.Bot<Bot>;
    Object.defineProperties(bot, {
      unique_id: {
        get() {
          return config.unique_id;
        },
      },
      quote_self: {
        get() {
          return discordAdapter.botConfig(bot)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return discordAdapter.botConfig(bot)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return discordAdapter.botConfig(bot)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      discordAdapter.emit('bot-ready', bot);
    });
    discordAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: Adapter.Bot<Bot>, event: DingTalkMessageEvent) => {
  const message = Message.fromEvent(discordAdapter, bot, event);
  message.raw_message = sendableToString(event.message).trim();
  message.from_id = event instanceof DirectMessageEvent ? event.user_id : event.channel_id;
  const master = discordAdapter.botConfig(bot)?.master;
  const admins = discordAdapter.botConfig(bot)?.admins;
  message.sender = {
    ...event.sender,
    permissions: [
      ...(event.sender?.permissions as unknown as string[]),
      master && event.sender?.user_id === master && 'master',
      admins && admins.includes(event.sender.user_id) && 'admins',
    ].filter(Boolean) as string[],
  };
  message.message_type = event.message_type;
  discordAdapter.app!.emit('message', discordAdapter, bot, message);
};
const stopBots = () => {
  for (const bot of discordAdapter.bots) {
    bot.stop();
  }
};
discordAdapter.on('start', startBots);
discordAdapter.on('stop', stopBots);
export default discordAdapter;
