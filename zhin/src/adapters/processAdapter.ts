import { Adapter, Message } from '@zhinjs/core';
declare module '@zhinjs/core' {
  namespace App {
    interface Adapters {
      process: {
        title: string;
      };
    }
  }
}
const processAdapter = new Adapter<Adapter.Bot<NodeJS.Process>>('process');
processAdapter.define('sendMsg', async (bot_id, target_id, target_type, message) => {
  processAdapter.logger.info(`send [${target_type} ${target_id}]: ${decodeURIComponent(message)}`);
});
const initBots = (configs: Adapter.Bot[]) => {
  for (const config of configs) {
    const bot = process as Adapter.Bot<NodeJS.Process>;
    Object.defineProperties(bot, {
      unique_id: {
        value: `process${configs.indexOf(config)}`,
        writable: false,
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
    processAdapter.bots.push(bot);
  }
  processAdapter.on('start', startBots);
};
const startBots = () => {
  for (const bot of processAdapter.bots) {
    bot.stdin.on('data', messageHandler.bind(global, bot));
    setTimeout(() => {
      processAdapter.emit('bot-ready', bot);
    }, 100);
  }
};

const messageHandler = (bot: Adapter.Bot<NodeJS.Process>, event: Buffer) => {
  const message = Message.fromEvent(processAdapter, bot, {});
  message.raw_message = event.toString().replace(/\n$/, '');
  message.from_id = 'developer';
  message.message_type = 'private';
  message.sender = {
    user_id: 'developer',
    user_name: bot.title,
    permissions: ['admin', 'master', 'normal'],
  };
  const commands = processAdapter.app!.getSupportCommands(processAdapter, bot, message);
  const matchReg = new RegExp(`^/(${commands.map(c => c.name).join('|')})`);
  if (message.raw_message.match(matchReg)) message.raw_message = message.raw_message.slice(1);
  processAdapter.logger.info(`recv [${message.message_type} ${message.from_id}]: ${message.raw_message}`);
  processAdapter.app!.emit('message', processAdapter, bot, message);
};
processAdapter.on('mounted', initBots);
export default processAdapter;
