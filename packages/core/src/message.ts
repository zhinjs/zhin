import { Bot, Dict } from '@/types';
import { Prompt } from '@/prompt';
import { Adapter, AdapterReceive } from '@/adapter';
export interface MessageBase {
  from_id: string;
  group_id?: string | number;
  guild_id?: string | number;
  channel_id?: string | number;
  discuss_id?: string | number;
  sender: MessageSender;
  raw_message: string;
  quote?: {
    message_id: string;
    message?: string;
  };
  message_type: Message.Type;
}
export interface Message<AD extends Adapter = Adapter> extends MessageBase {
  prompt: Prompt<any>;
  reply(message: string): Promise<any>;
}
export class Message<AD extends Adapter> {
  constructor(
    public adapter: AD,
    public bot: Bot<AD>,
    public original?: AdapterReceive<AD>,
  ) {}
  async reply(message: string, quote: boolean = true) {
    return this.adapter.sendMsg(this.bot.unique_id, this.from_id, this.message_type, message, quote ? this : undefined);
  }
  toJSON(): MessageBase {
    return {
      from_id: this.from_id,
      sender: this.sender,
      raw_message: this.raw_message,
      message_type: this.message_type,
    };
  }
}

export function parseFromTemplate(template: string | MessageElem): MessageElem[] {
  if (typeof template !== 'string') return [template];
  const result: MessageElem[] = [];
  const closingReg = /<(\S+)(\s[^\/]+)?\/>/;
  const twinningReg = /<(\S+)(\s[^>]+)?>([^<]*)<\/\1>/;
  while (template.length) {
    const [_, type, attrStr = '', child = ''] = template.match(closingReg) || template.match(twinningReg) || [];
    if (!type) break;
    const isClosing = closingReg.test(template);
    const matched = isClosing ? `<${type}${attrStr}/>` : `<${type}${attrStr}>${child}</${type}>`;
    const index = template.indexOf(matched);
    const prevText = template.slice(0, index);
    if (prevText)
      result.push({
        type: 'text',
        data: {
          text: decodeURIComponent(prevText),
        },
      });
    template = template.slice(index + matched.length);
    const attrArr = [...attrStr.matchAll(/\s([^=]+)(?=(?=="([^"]+)")|(?=='([^']+)'))/g)];
    const data = Object.fromEntries(
      attrArr.map(([source, key, v1, v2]) => {
        const value = v1 || v2;
        try {
          return [key, JSON.parse(decodeURIComponent(value))];
        } catch {
          return [key, decodeURIComponent(value)];
        }
      }),
    );
    result.push({
      type: type,
      data,
    } as MessageElem);
  }
  if (template.length) {
    result.push({
      type: 'text',
      data: {
        text: decodeURIComponent(template),
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
    text(text: string): string;
    face(id: number): string;
    image(url: string): string;
    at(user_id: string | number): string;
  };
  export type Type = 'private' | 'group' | 'guild' | 'direct';
  export function fromEvent<AD extends Adapter>(adapter: AD, bot: Bot<AD>, message: AdapterReceive<AD>) {
    const result = new Message(adapter, bot, message);
    result.prompt = new Prompt(adapter, bot, result);
    return result;
  }
  export function fromJSON<AD extends Adapter>(adapter: AD, bot: Bot<AD>, json: MessageBase) {
    const result = new Message(adapter, bot);
    result.from_id = json.from_id;
    result.sender = json.sender;
    result.message_type = json.message_type;
    result.raw_message = json.raw_message;
    result.prompt = new Prompt(adapter, bot, result);
    return result;
  }
}
export const segment: Message.DefineSegment = function (type, data) {
  if (type === 'text') return segment.text(data.text || '');
  return `<${type} ${Object.entries(data)
    .map(([key, value]) => {
      return `${key}='${encodeURIComponent(JSON.stringify(value))}'`;
    })
    .join(' ')}/>`;
} as Message.DefineSegment;
segment.text = text => encodeURIComponent(text);
segment.face = (id: number) => `<face id='${encodeURIComponent(id)}'/>`;
segment.image = (file: string) => `<image file='${encodeURIComponent(file)}'/>`;
segment.at = user_id => `<at user_id='${encodeURIComponent(user_id)}'/>`;
type MessageSender = {
  user_id?: string | number;
  user_name?: string;
  permissions?: string[];
};
