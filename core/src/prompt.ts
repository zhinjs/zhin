import { Dict } from '@zhinjs/shared';
import { Adapter } from './adapter';
import { Middleware } from './middleware';
import { Bot } from './types';
import { Message } from './message';
import { Schema } from './schema';
import { App } from './app';

export class Prompt<T extends Adapter = Adapter> {
  constructor(private event: Message<T>) {}
  get app() {
    return this.event.adapter.app;
  }
  private getChannelAddress<AD extends Adapter>(event: Message<AD>) {
    return `${event.adapter}-${event.bot.unique_id}-${event.message_type}:${event.sender!.user_id}`;
  }
  private prompt<T = any>(config: Prompt.Config<T>) {
    return new Promise<T>((resolve, reject) => {
      this.event.reply(config.tips);
      this.middleware(
        input => {
          if (input instanceof Error) {
            this.event.reply(input.message);
            if (config.defaultValue) resolve(config.defaultValue);
            else reject(input);
            return;
          }
          resolve(config.format(input));
        },
        config.timeout,
        config.timeoutText,
      );
    });
  }
  middleware(callback: (input: string | Error) => any, timeout: number = 3 * 60 * 1000, timeoutText = '输入超时') {
    const middleware: Middleware = (adapter, bot, event, next) => {
      if (this.getChannelAddress(event) !== this.getChannelAddress(this.event)) return next();
      callback(event.raw_message);
      dispose();
      clearTimeout(timer);
    };
    const dispose = this.app!.middleware(middleware);
    const timer = setTimeout(() => {
      dispose();
      callback(new Error(timeoutText));
    }, timeout);
  }
  async text(tips: string, timeout?: number, defaultValue = '', timeoutText?: string): Promise<string> {
    return this.prompt<string>({
      tips,
      defaultValue,
      timeoutText,
      timeout,
      format: (input: string) => input,
    });
  }
  async any(tips: string, timeout?: number, defaultValue = '', timeoutText?: string) {
    return this.prompt<string>({
      tips,
      defaultValue,
      timeoutText,
      timeout,
      format: (input: string) => input,
    });
  }
  async number(tips: string, timeout?: number, defaultValue = 0, timeoutText?: string): Promise<number> {
    return this.prompt<number>({
      tips,
      defaultValue,
      timeoutText,
      timeout,
      format: (input: string) => +input,
    });
  }
  async confirm(
    tips: string,
    condition: string = 'yes',
    timeout?: number,
    defaultValue = false,
    timeoutText?: string,
  ): Promise<boolean> {
    return this.prompt<boolean>({
      tips: `${tips}\n输入“${condition}”以确认`,
      defaultValue,
      timeout,
      timeoutText,
      format: (input: string) => input === condition,
    });
  }
  async list<T extends Prompt.SingleType = 'text'>(
    tips: string,
    config: Prompt.ListConfig<T> = { type: 'text' as T },
    timeoutText?: string,
  ): Promise<Prompt.Result<T>[]> {
    const separator = config.separator || ',';
    return this.prompt<Prompt.Result<T>[]>({
      tips: `${tips}\n值之间使用“${separator}”分隔`,
      defaultValue: config.defaultValue || [],
      timeout: config.timeout,
      timeoutText,
      format: (input: string) =>
        input.split(separator).map(v => {
          switch (config.type) {
            case 'boolean':
              return Boolean(v);
            case 'number':
              return +v;
            case 'text':
              return v;
          }
        }) as Prompt.Result<T>[],
    });
  }
  async const<T = any>(value: T): Promise<T> {
    return value;
  }
  async pick<T extends Prompt.SingleType, M extends boolean = false>(
    tips: string,
    config: Prompt.PickConfig<T, M>,
    timeoutText?: string,
  ): Promise<Prompt.PickResult<T, M>> {
    const moreTextArr = config.options.map((o, idx) => {
      return `${idx + 1}.${o.label}`;
    });
    const separator = config.separator || ',';
    if (config.multiple) moreTextArr.push(`多选请用“${separator}”分隔`);
    return this.prompt<Prompt.PickResult<T, M>>({
      tips: `${tips}\n${moreTextArr.join('\n')}`,
      defaultValue: config.defaultValue,
      timeout: config.timeout,
      timeoutText,
      format: (input: string) => {
        if (!config.multiple)
          return config.options.find((o, idx) => {
            return idx + 1 === +input;
          })?.value as Prompt.PickResult<T, M>;
        const pickIdx = input.split(separator).map(Number);
        return config.options
          .filter((o, idx) => {
            return pickIdx.includes(idx + 1);
          })
          .map(o => o.value) as Prompt.PickResult<T, M>;
      },
    });
  }
  async pickValueWithSchema<T extends Schema>(schema: T): Promise<Schema.Types<T>> {
    return this.pick(schema.meta.description, {
      type: '' as any,
      options: schema.meta.options!.map(o => ({
        label: o.label,
        value: o.value,
      })),
      multiple: schema.meta.multiple,
      defaultValue: schema.meta.default,
    });
  }
  async getValueWithSchemas<T extends Record<string, Schema>>(schemas: T): Promise<Schema.RecordTypes<T>> {
    const result: Dict = {};
    for (const key of Object.keys(schemas)) {
      const schema = schemas[key];
      result[key] = await this.getValueWithSchema(schema);
    }
    return result as Schema.RecordTypes<T>;
  }
  async getValueWithSchema<T extends Schema>(schema: T): Promise<Schema.Types<T>> {
    if (schema.meta.options) return this.pickValueWithSchema(schema);
    switch (schema.meta.type) {
      case 'number':
        return (await this.number(schema.meta.description)) as Schema.Types<T>;
      case 'string':
        return (await this.text(schema.meta.description)) as Schema.Types<T>;
      case 'boolean':
        return (await this.confirm(schema.meta.description)) as Schema.Types<T>;
      case 'object':
        if (schema.meta.description) await this.event.reply(schema.meta.description);
        return (await this.getValueWithSchemas(schema.options.object!)) as Schema.Types<T>;
      case 'date':
        return await this.prompt({
          tips: schema.meta.description,
          defaultValue: schema.meta.default || new Date(),
          format: (input: string) => new Date(input) as Schema.Types<T>,
        });
      case 'regexp':
        return await this.prompt({
          tips: schema.meta.description,
          defaultValue: schema.meta.default || '',
          format: (input: string) => new RegExp(input) as Schema.Types<T>,
        });
      case 'const':
        return await this.const(schema.meta.default!);
      case 'list':
        const inner = schema.options.inner!;
        if (!['string', 'boolean', 'number'].includes(inner.meta.type))
          throw new Error(`unsupported inner type :${inner.meta.type}`);
        return (await this.list(schema.meta.description, {
          type: inner.meta.type === 'string' ? 'text' : (inner.meta.type as Prompt.SingleType),
          defaultValue: schema.meta.default,
        })) as Schema.Types<T>;
      case 'dict':
      default:
        throw new Error(`Unsupported schema input type: ${schema.meta.type}`);
    }
  }
}
export namespace Prompt {
  interface SingleMap {
    text: string;
    number: number;
    boolean: boolean;
  }
  export interface ListConfig<T extends SingleType> {
    type: T;
    defaultValue?: SingleMap[T][];
    separator?: string;
    timeout?: number;
  }
  export interface PickConfig<T extends SingleType = SingleType, M extends boolean = false> {
    type: T;
    defaultValue?: M extends true ? SingleMap[T] : SingleMap[T][];
    separator?: string;
    timeout?: number;
    options: PickOption<T>[];
    multiple?: M;
  }
  export type PickOption<T extends SingleType = 'text'> = {
    label: string;
    value: SingleMap[T];
  };
  export type PickResult<T extends SingleType, M extends boolean> = M extends true ? Result<T>[] : Result<T>;
  export type SingleType = keyof SingleMap;
  export type Result<T extends SingleType> = SingleMap[T];
  export type Config<R = any> = {
    tips: string;
    defaultValue: any;
    timeout?: number;
    timeoutText?: string;
    format: (input: string) => R;
  };
}
