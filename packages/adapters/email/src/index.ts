import { Adapter, App, Message } from 'zhin';
import { Bot } from './bot';
declare module 'zhin' {
  namespace App {
    interface Adapters {
      email: Bot.Options;
    }
  }
}
const adapter = new Adapter<Adapter.Bot<Bot>, Bot.Message>('email');
adapter.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = adapter.bots.find(bot => bot.unique_id === bot_id);
  if (!bot) throw new Error(`cannot find bot ${bot_id}`);
  switch (target_type) {
    case 'private':
      return await bot.sendMessage(target_id, message);
    default:
      throw new Error(`unsupported target type ${target_type}`);
  }
});
const startBots = (configs: App.BotConfig<'email'>[]) => {
  for (const config of configs) {
    const bot = new Bot(adapter, config) as Adapter.Bot<Bot>;
    Object.defineProperties(bot, {
      unique_id: {
        get() {
          return config.unique_id;
        },
      },
      quote_self: {
        get() {
          return adapter.botConfig(bot)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return adapter.botConfig(bot)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return adapter.botConfig(bot)?.command_prefix || '';
        },
      },
    });
    bot.on('message', (message: Message<typeof adapter>) => {
      adapter.app?.emit('message', adapter, bot, message);
    });
    bot
      .start()
      .then(() => {
        adapter.emit('bot-ready', bot);
      })
      .catch(e => {
        adapter.logger.error(`Failed to start bot ${bot.unique_id}:`, e);
      });
    adapter.bots.push(bot);
  }
};
const stopBots = () => {
  for (const bot of adapter.bots) {
    bot.stop();
  }
};
adapter.on('start', startBots);
adapter.on('stop', stopBots);
export default adapter;
