import { Adapter, Message } from '@zhinjs/core';
import { unescape } from '@zhinjs/shared';
import { registerAdapter, defineMetadata } from './setup';
defineMetadata({ name: `process adapter` });
const processAdapter = registerAdapter('process');
export class ProcessBot extends Adapter.BaseBot<'process'> {
  constructor() {
    super(processAdapter, `${process.pid}`, process);
  }
  async handleSendMessage(channel: Message.Channel, message: string) {
    processAdapter.logger.info(`send [${channel}]: ${unescape(message)}`);
    return `${Date.now()}`;
  }
}
processAdapter.on('start', () => {
  const bot = new ProcessBot() as Adapter.Bot<'process'>;
  bot.stdin.on('data', (event: Buffer) => {
    const message = Message.from(processAdapter, bot, {
      message_id: `${Date.now()}`,
      channel: `private:${bot.pid}`,
      sender: {
        user_id: 'developer',
        user_name: bot.title,
        permissions: ['admin', 'master', 'normal'],
      },
      raw_message: event.toString().trimEnd(),
      message_type: 'private',
    });
    processAdapter.logger.info(`recv [${message.channel}]: ${message.raw_message}`);
    processAdapter.app!.emit('message', message);
  });
  setTimeout(() => {
    processAdapter.emit('bot-ready', bot);
  }, 100);
  processAdapter.bots.push(bot);
});
