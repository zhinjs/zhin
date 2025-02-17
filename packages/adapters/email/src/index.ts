import { Adapter, registerAdapter, Message, Schema, defineMetadata } from 'zhin';
import { Client } from './client';
declare module 'zhin' {
  namespace App {
    interface Adapters {
      email: Client.Options;
    }
    interface Clients {
      email: Client;
    }
  }
}
defineMetadata({ name: 'email adapter' });
const adapter = registerAdapter('email');

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
class EmailClient extends Adapter.BaseBot<'email'> {
  constructor(config: Adapter.BotConfig<'email'>) {
    super(adapter, config.unique_id, new Client(adapter, config));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source?: Message<'email'> | undefined,
  ): Promise<string> {
    const msg = message;
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    switch (target_type) {
      case 'private':
        return this.sendMessage(target_id, msg);
      default:
        throw new Error(`Email适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface EmailClient extends Client {}
const startBots = (configs: Adapter.BotConfig<'email'>[]) => {
  for (const config of configs) {
    const bot = new EmailClient(config) as Adapter.Bot<'email'>;
    bot.on('message', (message: Message<'email'>) => {
      adapter.app?.emit('message', message);
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
