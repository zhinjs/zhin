import { App } from './app';
import { EventEmitter } from 'events';
import { Message } from './message';
import path from 'path';
import { getLogger, Logger } from 'log4js';
import { Dict } from '@zhinjs/shared';
import { WORK_DIR } from './constans';
import { Schema } from './schema';

export type AdapterBot<A extends Adapter> = A extends Adapter<infer B> ? B : unknown;
export type AdapterReceive<A extends Adapter> = A extends Adapter<infer B, infer R> ? R : unknown;
export type Element = {
  type: string;
  data: Dict;
};
export class Adapter<I extends object = object, M = {}> extends EventEmitter {
  bots: Adapter.Bot<I>[] = [];
  elements: Element[] = [];
  private __IS_ZHIN_ADAPTER__ = true;
  app: App | null = null;
  static isAdapter(obj: any): obj is Adapter {
    return typeof obj === 'object' && !!obj['__IS_ZHIN_ADAPTER__'];
  }
  schemas: Schema = Schema.object({
    unique_id: Schema.string('请输入机器人唯一标识'),
    master: Schema.string('请输入主人id'),
    admins: Schema.list(Schema.string('管理员qq'), '请输入管理员id'),
    command_prefix: Schema.string('请输入指令前缀'),
    disabled_plugins: Schema.list(Schema.string('插件名'), '请输入禁用的插件').default([]),
    quote_self: Schema.boolean('回复是否引用源消息'),
  });
  #loggers: Dict<Logger> = {};
  getLogger(sub_type?: string | number): Logger {
    const logger = (this.#loggers[sub_type || this.name] ||= getLogger(
      `[${this.name}${sub_type ? ':' + sub_type : ''}]`,
    ));
    logger.level = this.app?.logger.level || 'info';
    return logger;
  }
  schema<X extends Record<string, Schema>>(schema: X) {
    Object.assign(this.schemas.options.object || {}, schema);
    return this;
  }
  get logger() {
    return this.getLogger();
  }
  constructor(public name: string) {
    super();
  }
  botConfig(bot: Adapter.Bot<I>) {
    return this.app!.config.bots.find(config => config.unique_id === bot.unique_id);
  }
  async sendMsg(
    bot_id: string,
    target_id: string,
    target_type: string,
    message: string,
    source?: Message<Adapter<I, M>>,
  ): Promise<any> {}
  define<T extends keyof Adapter<I, M>>(name: T, value: Adapter<I, M>[T]): void {
    Object.defineProperty(this, name, { value, writable: false, enumerable: false });
  }
  pick(bot_id: string) {
    const bot = this.bots.find(bot => bot.unique_id === bot_id);
    if (!bot) throw new Error(`未找到Bot:${bot_id}`);
    return bot;
  }
  element(element: Element): this;
  element(type: string, data: Dict): this;
  element(...args: [Element] | [string, Dict]) {
    const element =
      typeof args[0] === 'string'
        ? {
            type: args[0],
            data: args[1]!,
          }
        : args[0];
    this.elements.push(element);
    return this;
  }
  mount(app: App) {
    this.emit('before-mount');
    this.logger.level = app.config.log_level;
    this.app = app;
    this.emit('mounted', app);
  }
  unmount() {
    this.emit('before-unmount', this.app!);
    this.app = null;
    this.emit('unmounted');
  }
}

export interface Adapter {
  on<T extends keyof Adapter.EventMap>(event: T, listener: Adapter.EventMap[T]): this;

  on<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof Adapter.EventMap>,
    listener: (...args: any[]) => any,
  ): this;

  off<T extends keyof Adapter.EventMap>(event: T, callback?: Adapter.EventMap[T]): this;

  off<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof Adapter.EventMap>,
    callback?: (...args: any[]) => void,
  ): this;

  once<T extends keyof Adapter.EventMap>(event: T, listener: Adapter.EventMap[T]): this;

  once<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof Adapter.EventMap>,
    listener: (...args: any[]) => any,
  ): this;

  emit<T extends keyof Adapter.EventMap>(event: T, ...args: Parameters<Adapter.EventMap[T]>): boolean;

  emit<S extends string | symbol>(event: S & Exclude<string | symbol, keyof Adapter.EventMap>, ...args: any[]): boolean;

  addListener<T extends keyof Adapter.EventMap>(event: T, listener: Adapter.EventMap[T]): this;

  addListener<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof Adapter.EventMap>,
    listener: (...args: any[]) => any,
  ): this;

  addListenerOnce<T extends keyof Adapter.EventMap>(event: T, callback: Adapter.EventMap[T]): this;

  addListenerOnce<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof Adapter.EventMap>,
    callback: (...args: any[]) => void,
  ): this;

  removeListener<T extends keyof Adapter.EventMap>(event: T, callback?: Adapter.EventMap[T]): this;

  removeListener<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof Adapter.EventMap>,
    callback?: (...args: any[]) => void,
  ): this;

  removeAllListeners<T extends keyof Adapter.EventMap>(event: T): this;

  removeAllListeners<S extends string | symbol>(event: S & Exclude<string | symbol, keyof Adapter.EventMap>): this;
}
export namespace Adapter {
  export interface EventMap {
    'bot-ready'(bot: Bot<any>): void;
    'before-mount'(): void;
    'before-unmount'(app: App): void;
    'mounted'(app: App): void;
    'unmounted'(): void;
    'start'(configs: App.BotConfig[]): void;
  }
  export interface Config<T extends keyof App.Adapters = keyof App.Adapters> {
    name: T;
    bots: App.BotConfig<T>[];
  }
  export type SendMsgFn = (
    bot_id: string,
    target_id: string,
    target_type: Message.Type,
    message: string,
  ) => Promise<any>;
  export type Bot<T = object> = {
    unique_id: string;
    command_prefix?: string;
    quote_self?: boolean;
    forward_length?: number;
  } & T;
  export function load(name: string) {
    const maybePath = [
      path.join(WORK_DIR, 'node_modules', `@zhinjs`, name), // 官方适配器
      path.join(WORK_DIR, 'node_modules', `zhin-` + name), // 社区适配器
    ];
    for (const adapterPath of maybePath) {
      let result = null;
      try {
        result = require(adapterPath);
      } catch {}
      if (!result) continue;
      result = result.default || result;
      if (!Adapter.isAdapter(result)) throw new Error(`${adapterPath} is not an adapter`);
      return result;
    }
    throw new Error(`can't find adapter ${name}`);
  }
}
