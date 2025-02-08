import { Adapter, Message } from '@zhinjs/core';
import { unescape } from '@zhinjs/shared';
import { registerAdapter, defineMetadata } from './setup';
defineMetadata({ name: `process adapter` });
const processAdapter = registerAdapter('process');
export class ProcessBot extends Adapter.Bot<'process'> {
  constructor(config: Adapter.BotConfig<'process'>) {
    process.title = config.title || 'process';
    super(processAdapter, config.unique_id, process);
  }
  async handleSendMessage(channel: Message.Channel, message: string, source: Message<'process'> | undefined) {
    processAdapter.logger.info(`send [${channel}]: ${unescape(message)}`);
    return `${Date.now()}`;
  }
}
export interface ProcessBot extends NodeJS.Process {}
processAdapter.on('start', (configs: Adapter.BotConfig<'process'>[]) => {
  for (const config of configs) {
    const bot = new ProcessBot(config);
    bot.stdin.on('data', (event: Buffer) => {
      const message = Message.from(processAdapter, bot, {
        message_id: `${Date.now()}`,
        channel: `private:${bot.title}`,
        sender: {
          user_id: 'developer',
          user_name: bot.title,
          permissions: ['admin', 'master', 'normal'],
        },
        raw_message: event.toString().trimEnd(),
        message_type: 'private',
      });
      processAdapter.logger.info(`recv [${message.channel}]: ${message.raw_message}`);
      processAdapter.app!.emit('message', processAdapter, bot, message);
    });
    setTimeout(() => {
      processAdapter.emit('bot-ready', bot);
    }, 100);
    processAdapter.bots.push(bot);
  }
});
