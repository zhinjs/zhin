import { Adapter, App, Message, Schema, unescape } from 'zhin';
import { Client } from '@/client';
import { kritor } from 'kritor-proto';

declare module 'zhin' {
  namespace App {
    interface Adapters {
      kritor: Client.Options;
    }
  }
}
const adapter = new Adapter<Client, kritor.common.IPushMessageBody>('kritor');
adapter.schema({
  url: Schema.string('请输入kritor服务端地址').required(),
  super_ticket: Schema.string('请输入super_ticket'),
});
adapter.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = adapter.pick(bot_id);
  let template: string = await adapter.app!.renderMessage(message as string, source);
  const contact = bot.createContact(target_id, target_type as any);
  await bot.sendMessage(contact, Client.createElementsFromTemplate(template));
  bot.logger.info(`send [${target_type} ${target_id}]:${unescape(message)}`);
});
const messageHandler = (bot: Adapter.Bot<Client>, event: kritor.common.IPushMessageBody) => {
  const message = Message.fromEvent(adapter, bot, event);
  message.raw_message = Client.eventMessageToString(event);
  message.message_type = Client.getMessageType(event) as Message.Type;
  message.from_id = Array.from(new Set([event.contact?.peer, event.contact?.sub_peer]))
    .filter(Boolean)
    .join(':');
  const master = adapter.botConfig(bot)?.master;
  const admins = adapter.botConfig(bot)?.admins.filter(Boolean) || [];
  message.sender = {
    user_id: event.sender?.uid!,
    user_name: event.sender?.nick || '',
    permissions: [
      master && event.sender?.uid === master && 'master',
      admins && admins.includes(event.sender?.uid || '') && 'admins',
    ].filter(Boolean) as string[],
  };
  bot.logger.info(`recv [${message.message_type} ${message.from_id}]: ${message.raw_message}`);
  adapter.app!.emit('message', adapter, bot, message);
};
const startBots = (configs: App.BotConfig<'kritor'>[]) => {
  for (const config of configs) {
    const bot = new Client(adapter, config) as Adapter.Bot<Client>;
    Object.defineProperties(bot, {
      unique_id: {
        value: config.unique_id,
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
          return adapter.botConfig(bot)?.command_prefix;
        },
      },
    });
    bot.on('message', messageHandler.bind(global, bot));
    bot.start().then(() => {
      adapter.emit('bot-ready', bot);
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
