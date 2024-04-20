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

const initBot = (configs: App.BotConfig<'discord'>[]) => {
  for (const config of configs) {
    const bot = new Bot(config);
    Object.defineProperties(bot, {
      unique_id: {
        get() {
          return bot.self_id;
        },
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
    discordAdapter.bots.push(bot as Adapter.Bot<Bot>);
  }
  discordAdapter.on('start', startBots);
  discordAdapter.on('stop', stopBots);
};
const messageHandler = (bot: Adapter.Bot<Bot>, event: DingTalkMessageEvent) => {
  const message = Message.fromEvent(discordAdapter, bot, event);
  message.raw_message = sendableToString(event.message).trim();
  message.from_id = event instanceof DirectMessageEvent ? event.user_id : event.channel_id;
  const master = discordAdapter.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.master;
  const admins = discordAdapter.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.admins;
  message.sender = {
    ...event.sender,
    permissions: [
      ...(event.sender?.permissions as unknown as string[]),
      master && event.sender?.user_id === master && 'master',
      admins && admins.includes(event.sender.user_id) && 'admins',
    ].filter(Boolean) as string[],
  };
  message.message_type = event.message_type;
  const commands = discordAdapter.app!.getSupportCommands(discordAdapter, bot, message);
  const matchReg = new RegExp(`^/(${commands.map(c => c.name).join('|')})`);
  if (message.raw_message.match(matchReg)) message.raw_message = message.raw_message.slice(1);
  discordAdapter.app!.emit('message', discordAdapter, bot, message);
};
const startBots = () => {
  for (const bot of discordAdapter.bots) {
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      discordAdapter.emit('bot-ready', bot);
    });
  }
};
const stopBots = () => {
  for (const bot of discordAdapter.bots) {
    bot.stop();
  }
};
discordAdapter.on('mounted', initBot);
export default discordAdapter;
