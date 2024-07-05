import { Adapter, App, Message, Schema } from 'zhin';
import { Bot } from './bot';
declare module 'zhin' {
  namespace App {
    interface Adapters {
      email: Bot.Options;
    }
  }
}
const adapter = new Adapter<Adapter.Bot<Bot>, Bot.Message>('email');

adapter.schema({
  username: Schema.string('请输入邮箱账号').required(),
  password: Schema.string('请输入邮箱密码或授权码').required(),
  imap: Schema.object({
    host: Schema.string('请输入邮箱IMAP服务器').required(),
    port: Schema.number('请输入邮箱IMAP服务器端口').default(993),
    tls: Schema.boolean('是否使用SSL/TLS').default(true),
  }),
  smtp: Schema.object({
    host: Schema.string('请输入邮箱SMTP服务器').required(),
    port: Schema.number('请输入邮箱SMTP服务器端口').default(465),
    tls: Schema.boolean('是否使用SSL/TLS').default(true),
  }),
});
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
