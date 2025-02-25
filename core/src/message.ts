import { Dict, escape, unescape } from '@zhinjs/shared';
import { Prompt } from './prompt';
import { Adapter } from './adapter';
import { Adapters, App } from './app';
import path from 'path';
import * as fs from 'node:fs';
export interface MessageBase {
  message_id?: string;
  channel: Message.Channel;
  sender: Message.Sender;
  message_type: Message.Type;
  raw_message: string;
  quote?: {
    message_id: string;
    message?: string;
  };
}
export interface Message<P extends keyof App.Adapters = keyof App.Adapters> extends MessageBase {
  prompt: Prompt<P>;
  reply(message: string): Promise<any>;
}
export class Message<P extends keyof App.Adapters> {
  constructor(
    public adapter: Adapter<P>,
    public bot: Adapter.Bot<P>,
    message_base: MessageBase,
  ) {
    Object.assign(this, message_base);
    const permissions: Set<string> = new Set<string>(this.sender.permissions);
    if (adapter.botConfig(bot.unique_id)?.master === this.sender.user_id) {
      permissions.add('master');
    }
    if (adapter.botConfig(bot.unique_id)?.admins?.includes(this.sender.user_id!)) {
      permissions.add('admin');
    }
    this.sender.permissions = [...permissions];
  }
  get group_id() {
    if (this.message_type !== 'group') return undefined;
    return this.channel.split(':')[1];
  }
  get user_id() {
    return this.sender.user_id;
  }
  get channel_id() {
    if (this.message_type !== 'guild') return undefined;
    return this.channel.split(':')[1];
  }
  get guild_id() {
    if (this.message_type !== 'direct') return undefined;
    return this.channel.split(':')[1];
  }
  async reply(message: string, quote: boolean = true) {
    return this.bot.sendMsg(this.channel, message, quote ? this : undefined);
  }
  toJSON(): MessageBase {
    return {
      message_id: this.message_id,
      channel: this.channel,
      message_type: this.message_type,
      sender: this.sender,
      raw_message: this.raw_message,
      quote: this.quote,
    };
  }
}
export function parseFromTemplate(template: string | MessageElem): MessageElem[] {
  if (typeof template !== 'string') return [template];
  const result: MessageElem[] = [];
  const closingReg = /^<(\S+)(\s[^>]+)?>/;
  const twinningReg = /^<(\S+)(\s[^>]+)?>([\s\S]*?)<\/\1>/;
  while (template.length) {
    const [_, type, attrStr = '', child = ''] = template.match(twinningReg) || template.match(closingReg) || [];
    if (!type) break;
    const isClosing = closingReg.test(template);
    const matched = isClosing ? `<${type}${attrStr}/>` : `<${type}${attrStr}>${child}</${type}>`;
    const index = template.indexOf(matched);
    const prevText = template.slice(0, index);
    if (prevText)
      result.push({
        type: 'text',
        data: {
          text: unescape(prevText),
        },
      });
    template = template.slice(index + matched.length);
    const attrArr = [...attrStr.matchAll(/\s([^=]+)(?=(?=="([^"]+)")|(?=='([^']+)'))/g)];
    const data = Object.fromEntries(
      attrArr.map(([source, key, v1, v2]) => {
        const value = v1 || v2;
        try {
          return [key, JSON.parse(unescape(value))];
        } catch {
          return [key, unescape(value)];
        }
      }),
    );
    if (child) {
      // TODO temporarily use 'message' as the key of the child MessageElem
      data.message = parseFromTemplate(child).map(({ type, data }) => ({ type, ...data }));
    }
    result.push({
      type: type,
      data,
    } as MessageElem);
  }
  if (template.length) {
    result.push({
      type: 'text',
      data: {
        text: unescape(template),
      },
    });
  }
  return result;
}
type MessageElem = {
  type: string;
  data: Dict;
};
export namespace Message {
  export type Render<T extends Message = Message> = (template: string, message?: T) => Promise<string> | string;
  export type Segment = `<${string},${string}>` | string;
  export type DefineSegment = {
    (type: string, data: Dict): string;
    text(text?: string): string;
    face(id: number): string;
    image(path: string, type?: string): string;
    image(url: string, type?: string): string;
    image(data: Uint8Array, type?: string): string;
    image(base64: string, type?: string): string;
    video(path: string, type?: string): string;
    video(url: string, type?: string): string;
    video(data: Uint8Array, type?: string): string;
    video(base64: string, type?: string): string;
    audio(path: string, type?: string): string;
    audio(url: string, type?: string): string;
    audio(data: Uint8Array, type?: string): string;
    audio(base64: string, type?: string): string;
    at(user_id: string | number): string;
  };
  export type Type = 'private' | 'group' | 'guild' | 'direct';
  export function from<P extends Adapters>(adapter: Adapter<P>, bot: Adapter.Bot<P>, message: MessageBase) {
    const result = new Message<P>(adapter, bot, message);
    result.prompt = new Prompt(result);
    return result;
  }
  export type Channel = `${Type}:${string}`;
  export interface Sender {
    user_id?: string | number;
    user_name?: string;
    permissions?: string[];
  }
}
export const segment: Message.DefineSegment = function (type, data) {
  if (type === 'text') return segment.text(data.text || '');
  return `<${type} ${Object.entries(data)
    .map(([key, value]) => {
      return `${key}='${escape(JSON.stringify(value))}'`;
    })
    .join(' ')}/>`;
} as Message.DefineSegment;
function formatSourceDataTostring<T extends string | Uint8Array>(data: T): string {
  const result: string = typeof data === 'string' ? data : `base64://${Buffer.from(data).toString('base64')}`;
  if (fs.existsSync(result)) return `base64://${fs.readFileSync(result).toString('base64')}`;
  return result;
}
segment.text = text => escape(text || '');
segment.face = (id: number) => `<face id='${escape(id.toString())}'/>`;
segment.image = (file: string | Uint8Array, type = 'png') => {
  file = formatSourceDataTostring(file);
  return `<image file='${escape(file)}' type='${type}'/>`;
};
segment.video = (file: string | Uint8Array, type = 'mp4') => {
  file = formatSourceDataTostring(file);
  return `<video file='${escape(file)}' file_type='${type}'/>`;
};
segment.audio = (file: string | Uint8Array, type = 'mp3') => {
  file = formatSourceDataTostring(file);
  return `<audio file='${escape(file)}' file_type='${type}'/>`;
};
segment.at = user_id => `<at user_id='${escape(user_id.toString())}'/>`;
