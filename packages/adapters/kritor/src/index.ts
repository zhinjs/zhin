import { Adapter, registerAdapter, Message, Schema, unescape, defineMetadata } from 'zhin';
import { Client } from '@/client';
import { kritor } from 'kritor-proto';

declare module 'zhin' {
  namespace App {
    interface Adapters {
      kritor: Client.Options;
    }
    interface Clients {
      kritor: Client;
    }
  }
}
defineMetadata({ name: 'kritor adapter' });
const adapter = registerAdapter('kritor');
adapter.schema({
  url: Schema.string('请输入kritor服务端地址').required(),
  super_ticket: Schema.string('请输入super_ticket'),
});
class KritorClient extends Adapter.BaseBot<'kritor'> {
  constructor(config: Adapter.BotConfig<'kritor'>) {
    super(adapter, config.unique_id, new Client(adapter, config));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source?: Message<'kritor'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    const contact = this.createContact(target_id, target_type as any);
    const result = await this.sendMessage(contact, Client.createElementsFromTemplate(message));
    this.logger.info(`send [${target_type} ${target_id}]:${unescape(message)}`);
    return result?.message_id || '';
  }
}
interface KritorClient extends Client {}
const messageHandler = (bot: Adapter.Bot<'kritor'>, event: kritor.common.IPushMessageBody) => {
  const master = adapter.botConfig(bot.unique_id)?.master;
  const admins = adapter.botConfig(bot.unique_id)?.admins?.filter(Boolean) || [];
  const message = Message.from(adapter, bot, {
    raw_message: Client.eventMessageToString(event),
    message_type: Client.getMessageType(event) as Message.Type,
    channel: Array.from(new Set([event.contact?.peer, event.contact?.sub_peer]))
      .filter(Boolean)
      .join(':') as any,
    sender: {
      user_id: event.sender?.uid!,
      user_name: event.sender?.nick || '',
      permissions: [
        master && event.sender?.uid === master && 'master',
        admins && admins.includes(event.sender?.uid || '') && 'admins',
      ].filter(Boolean) as string[],
    },
  });
  bot.logger.info(`recv [${message.channel})]: ${message.raw_message}`);
  adapter.app!.emit('message', adapter, bot, message);
};
const startBots = (configs: Adapter.BotConfig<'kritor'>[]) => {
  for (const config of configs) {
    const bot = new KritorClient(config) as Adapter.Bot<'kritor'>;
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
