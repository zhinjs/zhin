import { Adapter, Message, Schema, registerAdapter, defineMetadata } from 'zhin';
import { Client, Config, Quotable } from '@icqqjs/icqq';
import * as process from 'process';
import { createMessageBase, createQuote, formatSendable } from '@/utils';
import { QQMessageEvent } from '@/types';
defineMetadata({ name: 'icqq adapter' });
const icqqAdapter = registerAdapter('icqq');
icqqAdapter
  .element({
    type: 'text',
    data: {
      text: 'string',
    },
  })
  .element({
    type: 'face',
    data: {
      id: 'number',
      text: 'string',
    },
  })
  .element({
    type: 'at',
    data: {
      qq: ['string', 'number'],
    },
  })
  .element({
    type: 'image',
    data: {
      file: 'string',
    },
  })
  .element({
    type: 'record',
    data: {
      file: 'string',
    },
  })
  .element({
    type: 'video',
    data: {
      file: 'string',
    },
  })
  .element({
    type: 'node',
    data: {
      user_id: 'number',
      message: 'string',
    },
  })
  .element({
    type: 'json',
    data: {
      data: 'string',
    },
  })
  .element({
    type: 'xml',
    data: {
      data: 'string',
    },
  })
  .element({
    type: 'markdown',
    data: {
      content: 'string',
    },
  });
icqqAdapter.schema({
  uin: Schema.number('请输入机器人qq').required(),
  password: Schema.string('请输入机器人密码').required(),
  ver: Schema.string('请输入使用版本(例如：8.9.80)').required(),
  platform: Schema.number('请选择登录平台')
    .option([
      { label: '安卓手机(Android)', value: 1 },
      { label: '安卓平板(aPad)', value: 2 },
      { label: '安卓手表(Watch)', value: 3 },
      { label: 'MacOS(Mac电脑)', value: 4 },
      { label: 'iPad(苹果平板)', value: 5 },
    ])
    .required()
    .default(3),
  sign_api_addr: Schema.string('请输入签名API地址').required(),
});
declare module 'zhin' {
  namespace App {
    interface Adapters {
      icqq: QQConfig;
    }
    interface Clients {
      icqq: Client;
    }
  }
}
type QQConfig = {
  uin: number;
  password?: string;
} & Config;
class QQClient extends Adapter.BaseBot<'icqq'> {
  constructor(config: Adapter.BotConfig<'icqq'>) {
    super(icqqAdapter, config.unique_id, new Client(config.uin, config));
  }
  async handleSendMessage(
    channel: Message.Channel,
    message: string,
    source?: Message<'icqq'> | undefined,
  ): Promise<string> {
    const [target_type, ...other] = channel.split(':');
    const target_id = other.join(':');
    let msg = formatSendable(message);
    const quote: Quotable | undefined = target_type !== 'guild' && source ? createQuote(source) : undefined;
    const textLen = msg.filter(e => e.type === 'text').reduce((result, cur) => result + String(cur).length, 0);
    if (this.forward_length && textLen > this.forward_length)
      msg = [
        {
          type: 'node',
          user_id: this.uin,
          nickname: this.nickname,
          time: Date.now() / 1000,
          message: msg,
        },
      ];
    const disabledQuote =
      !this.quote_self ||
      msg.some(e => {
        return ['node', 'music', 'share', 'reply', 'quote'].includes(e.type);
      });
    switch (target_type) {
      case 'group':
        return (await this.sendGroupMsg(parseInt(target_id), msg, disabledQuote ? undefined : quote)).message_id;
      case 'private':
        return (await this.sendPrivateMsg(parseInt(target_id), msg, disabledQuote ? undefined : quote)).message_id;
      case 'guild':
        const [guild_id, channel_id] = target_id.split(':');
        const { time, seq, rand } = await this.sendGuildMsg(guild_id, channel_id, message);
        return `${time}/${seq}/${rand}`;
      default:
        throw new Error(`ICQQ适配器暂不支持发送${target_type}类型的消息`);
    }
  }
}
interface QQClient extends Client {}
const startBots = async (configs: Adapter.BotConfig<'icqq'>[]) => {
  for (const config of configs) {
    const bot = new QQClient(config) as Adapter.Bot<'icqq'>;
    bot.once('system.online', () => {
      icqqAdapter.emit('bot-ready', bot);
    });
    await botLogin(bot);
    icqqAdapter.bots.push(bot);
  }
};
const messageHandler = (bot: QQClient, event: QQMessageEvent) => {
  const message = Message.from(icqqAdapter, bot, createMessageBase(event));
  icqqAdapter.app!.emit('message', message);
};
const botLogin = async (bot: QQClient) => {
  return new Promise<void>(resolve => {
    bot.on('system.online', () => {
      bot.on('message', messageHandler.bind(global, bot));
      resolve();
    });
    bot.on('system.login.device', e => {
      icqqAdapter.app!.logger.mark('请选择设备验证方式：\n1.扫码验证\t其他.短信验证');
      process.stdin.once('data', buf => {
        const input = buf.toString().trim();
        if (input === '1') {
          icqqAdapter.app!.logger.mark('请点击上方链接完成验证后回车继续');
          process.stdin.once('data', () => {
            bot.login();
          });
        } else {
          bot.sendSmsCode();
          icqqAdapter.app!.logger.mark(`请输入手机号(${e.phone})收到的短信验证码：`);
          process.stdin.once('data', buf => {
            bot.submitSmsCode(buf.toString().trim());
          });
        }
      });
    });
    bot.on('system.login.qrcode', () => {
      icqqAdapter.app!.logger.mark('请扫描二维码后回车继续');
      process.stdin.once('data', () => {
        bot.login();
      });
    });
    bot.on('system.login.slider', () => {
      icqqAdapter.app!.logger.mark('请点击上方链接，完成滑块验证后，输入获取到的ticket后继续');
      process.stdin.once('data', buf => {
        bot.submitSlider(buf.toString().trim());
      });
    });
    bot.on('system.login.error', () => {
      resolve();
    });
    bot.login(icqqAdapter.botConfig(bot.unique_id)?.password);
  });
};
const stopBots = () => {
  for (const bot of icqqAdapter.bots) {
    bot.terminate();
  }
};

icqqAdapter.on('start', startBots);
icqqAdapter.on('stop', stopBots);
