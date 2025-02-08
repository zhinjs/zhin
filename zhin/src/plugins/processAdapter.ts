import { Adapter, Message } from '@zhinjs/core';
import { unescape } from '@zhinjs/shared';

const processAdapter = new Adapter('process');
export class ProcessBot extends Adapter.Bot<'process'> {
  constructor(config: Adapter.BotConfig<'process'>) {
    super(processAdapter, config.unique_id, process);
  }
  async handleSendMessage(channel: Message.Channel, message: string, source: Message<Adapter<'process'>> | undefined) {
    processAdapter.logger.info(`send [${channel}]: ${unescape(message)}`);
    return `${Date.now()}`;
  }
}
export interface ProcessBot extends NodeJS.Process {}
const startBots = (configs: Adapter.BotConfig<'process'>[]) => {
  for (const config of configs) {
    const bot = new ProcessBot(config);
    bot.stdin.on('data', messageHandler.bind(global, bot));
    setTimeout(() => {
      processAdapter.emit('bot-ready', bot);
    }, 100);
    processAdapter.bots.push(bot);
  }
};

processAdapter.on('start', startBots);
const messageHandler = (bot: ProcessBot, event: Buffer) => {
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
  const commands = processAdapter.app!.getSupportCommands(processAdapter.name);
  const matchReg = new RegExp(`^/(${commands.map(c => c.name).join('|')})`);
  if (message.raw_message.match(matchReg)) message.raw_message = message.raw_message.slice(1);
  processAdapter.logger.info(`recv [${message.channel}]: ${message.raw_message}`);
  processAdapter.app!.emit('message', processAdapter, bot, message);
};
export default processAdapter;
