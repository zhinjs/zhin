import { Adapter, App, Message } from 'zhin';
import {
  Client,
  PrivateMessageEvent,
  DiscussMessageEvent,
  GroupMessageEvent,
  GuildMessageEvent,
  genDmMessageId,
  genGroupMessageId,
  Config,
  Quotable,
} from '@icqqjs/icqq';
import * as process from 'process';
import { formatSendable, sendableToString } from '@/utils';

type QQMessageEvent = PrivateMessageEvent | GroupMessageEvent | DiscussMessageEvent | GuildMessageEvent;
type ICQQAdapterConfig = App.BotConfig<'icqq'>[];
export type ICQQAdapter = typeof icqq;
const icqq = new Adapter<Adapter.Bot<Client>, QQMessageEvent>('icqq');
icqq
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
icqq
  .schema('uin', {
    method: 'number',
    args: ['请输入机器人qq'],
  })
  .schema('password', {
    method: 'text',
    args: ['请输入机器人密码'],
  })
  .schema('ver', {
    method: 'text',
    args: ['请输入使用版本'],
  })
  .schema('platform', {
    method: 'pick',
    args: [
      '请选择登录平台',
      {
        type: 'number',
        options: [
          { label: '安卓手机(Android)', value: 1 },
          { label: '苹果平板(aPad)', value: 2 },
          { label: '安卓手表(Watch)', value: 3 },
          { label: 'MacOS(iMac)', value: 4 },
          { label: 'iPad', value: 5 },
        ],
      },
    ],
  })
  .schema('sign_api_addr', {
    method: 'text',
    args: ['请输入签名API地址'],
  });
declare module 'zhin' {
  namespace App {
    interface Adapters {
      icqq: QQConfig;
    }
  }
}
icqq.define('sendMsg', async (bot_id, target_id, target_type, message, source) => {
  const bot = icqq.pick(bot_id);
  let template: string = await icqq.app!.renderMessage(message as string, source);
  let msg = formatSendable(template);
  const quote: Quotable | undefined = target_type !== 'guild' && source ? (source.original as any) : undefined;
  const textLen = msg.filter(e => e.type === 'text').reduce((result, cur) => result + String(cur).length, 0);
  if (bot.forward_length && textLen > bot.forward_length)
    msg = [
      {
        type: 'node',
        user_id: bot.uin,
        nickname: bot.nickname,
        time: Date.now() / 1000,
        message: msg,
      },
    ];
  const disabledQuote =
    !bot.quote_self ||
    msg.some(e => {
      return ['node', 'music', 'share', 'reply', 'quote'].includes(e.type);
    });
  switch (target_type) {
    case 'group':
      return bot.sendGroupMsg(parseInt(target_id), msg, disabledQuote ? undefined : quote);
    case 'private':
      return bot.sendPrivateMsg(parseInt(target_id), msg, disabledQuote ? undefined : quote);
    case 'guild':
      const [guild_id, channel_id] = target_id.split(':');
      return bot.sendGuildMsg(guild_id, channel_id, message);
    default:
      throw new Error(`ICQQ适配器暂不支持发送${target_type}类型的消息`);
  }
});
type QQConfig = {
  uin: number;
  password?: string;
} & Config;
let adapterConfig: ICQQAdapterConfig;
const initBot = (configs: App.BotConfig<'icqq'>[]) => {
  adapterConfig = configs;
  for (const { uin, password: _, quote_self, forward_length, ...config } of configs) {
    const bot = new Client(uin, config) as Adapter.Bot<Client>;
    Object.defineProperties(bot, {
      unique_id: {
        value: config.unique_id,
        writable: false,
      },
      quote_self: {
        get() {
          return icqq.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.quote_self;
        },
      },
      forward_length: {
        get() {
          return icqq.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.forward_length;
        },
      },
      command_prefix: {
        get() {
          return icqq.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.command_prefix;
        },
      },
    });
    icqq.bots.push(bot);
  }
  icqq.on('start', startBots);
  icqq.on('stop', stopBots);
};
const messageHandler = (bot: Adapter.Bot<Client>, event: QQMessageEvent) => {
  const message = Message.fromEvent(icqq, bot, event);
  message.raw_message = sendableToString(event.message);
  if (!(event instanceof GuildMessageEvent)) {
    message.message_type = event.message_type as any;
    message.from_id =
      event.message_type === 'private'
        ? event.sender.user_id + ''
        : event.message_type === 'group'
        ? event.group_id + ''
        : event.discuss_id + '';
    const master = icqq.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.master;
    const admins = icqq.app!.config.bots.find(b => b.unique_id === bot.unique_id)?.admins;
    message.sender = {
      ...event.sender,
      permissions: [
        master && `${event.user_id}` === master && 'master',
        event.message_type === 'group' && event.member?.is_owner && 'owner',
        admins && admins.includes(`${event.user_id}`) && 'admins',
        event.message_type === 'group' && event.member?.is_admin && 'admin',
      ].filter(Boolean) as string[],
    };
    if (event.source) {
      message.quote = {
        message_id:
          event.message_type === 'private'
            ? genDmMessageId(
                event.source.user_id,
                event.source.seq,
                event.source.rand,
                event.source.time,
                event.source.user_id === bot.uin ? 1 : 0,
              )
            : event.message_type === 'group'
            ? genGroupMessageId(
                event.group_id,
                event.source.user_id,
                event.source.seq,
                event.source.rand,
                event.source.time,
              )
            : '',
        message: event.source.message as string,
      };
    }
  } else {
    message.from_id = `${event.guild_id}:${event.channel_id}`;
    message.sender = {
      user_id: event.sender.tiny_id,
      user_name: event.sender.nickname,
    };
    message.message_type = 'guild';
  }
  icqq.app!.emit('message', icqq, bot, message);
};
const botLogin = async (bot: Adapter.Bot<Client>) => {
  return new Promise<void>(resolve => {
    bot.on('system.online', () => {
      bot.on('message', messageHandler.bind(global, bot));
      resolve();
    });
    bot.on('system.login.device', e => {
      icqq.app!.logger.mark('请选择设备验证方式：\n1.扫码验证\t其他.短信验证');
      process.stdin.once('data', buf => {
        const input = buf.toString().trim();
        if (input === '1') {
          icqq.app!.logger.mark('请点击上方链接完成验证后回车继续');
          process.stdin.once('data', () => {
            bot.login();
          });
        } else {
          bot.sendSmsCode();
          icqq.app!.logger.mark(`请输入手机号(${e.phone})收到的短信验证码：`);
          process.stdin.once('data', buf => {
            bot.submitSmsCode(buf.toString().trim());
          });
        }
      });
    });
    bot.on('system.login.qrcode', () => {
      icqq.app!.logger.mark('请扫描二维码后回车继续');
      process.stdin.once('data', () => {
        bot.login();
      });
    });
    bot.on('system.login.slider', () => {
      icqq.app!.logger.mark('请点击上方链接，完成滑块验证后，输入获取到的ticket后继续');
      process.stdin.once('data', buf => {
        bot.submitSlider(buf.toString().trim());
      });
    });
    bot.on('system.login.error', () => {
      resolve();
    });
    const password = adapterConfig.find(c => c.uin === bot.uin)?.password;
    bot.login(password);
  });
};
const startBots = async () => {
  for (const bot of icqq.bots) {
    bot.once('system.online', () => {
      icqq.emit('bot-ready', bot);
    });
    await botLogin(bot);
  }
};
const stopBots = () => {
  for (const bot of icqq.bots) {
    bot.terminate();
  }
};
icqq.on('mounted', initBot);

export default icqq;
