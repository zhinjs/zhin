import { Plugin, Message } from '@zhinjs/core';
const plugin = new Plugin('功能定义与处理');
declare module '@zhinjs/core' {
  namespace App {
    interface Services {
      functionManager: FunctionManager;
      functions: FunctionManager.FunctionInfo[];
      register: typeof FunctionManager.prototype.register;
    }
  }
}
class FunctionManager {
  public functions: FunctionManager.FunctionInfo[] = [];
  register(fn: FunctionManager.Fn): this;
  register(name: string, fn: FunctionManager.Fn): this;
  register(name: string, result: string): this;
  register(...args: [FunctionManager.Fn] | [string, FunctionManager.Fn] | [string, string]) {
    const getFunctionInfo = (): [string, FunctionManager.Fn] => {
      if (typeof args[0] === 'string') {
        if (typeof args[1] === 'function') return args as [string, FunctionManager.Fn];
        if ((args[1] as string).startsWith('#'))
          return [
            args[0],
            function (this: Message) {
              return FunctionManager.transform(this, String(args[1]).slice(1));
            },
          ];
        return [args[0], () => args[1]];
      }
      if (typeof args[0] === 'function') return [args[0].name, args[0]];
      throw new Error('invalid arguments');
    };
    let [name, fn] = getFunctionInfo(),
      hidden = false;
    if (name.startsWith('#')) {
      hidden = true;
      name = name.slice(1);
    }
    const ARGS =
      String(fn)
        .match(/\(.*\)/)?.[0]
        .replace('(', '')
        .replace(')', '')
        .split(',')
        .filter(Boolean)
        .map(v => v.trim()) || [];
    const argsInfo = ARGS.map(FunctionManager.analysisArg);
    const functionInfo: FunctionManager.FunctionInfo = {
      name,
      hidden,
      argsInfo,
      argsLength: fn.length,
      match: FunctionManager.createFnMatch(),
      handler: fn,
    };
    this.functions.push(functionInfo);
    return this;
  }
  async match<T extends Message>(message: T) {
    const matchedInfos = this.functions
      .map(fn => {
        const args = fn.match(message);
        if (args) return { fn, args };
      })
      .filter(Boolean);
    for (const matchedInfo of matchedInfos) {
      if (!matchedInfo) continue;
      const { fn, args } = matchedInfo;
      const result = await fn.handler.apply(message, args);
      if (result) return message.reply(result);
    }
  }
}
namespace FunctionManager {
  type MaybePromise<T> = Promise<T> | T;
  export type Fn = (this: Message, ...args: any[]) => MaybePromise<any | void>;
  export interface FunctionInfo {
    name: string;
    argsLength: number;
    hidden: boolean;
    match: (message: Message) => string[] | undefined;
    argsInfo: ArgInfo[];
    handler: Function;
  }
  export interface ArgInfo {
    name: string;
    index: number;
    required: boolean;
    defaultValue: any;
  }
  export function transform(message: Message, str: string): string {
    return str.replace(/\{([^}]+)}/g, (data, value) => {
      return message[value as keyof Message] as string;
    });
  }
  export function analysisArg(arg: string, index: number): ArgInfo {
    const [name, defaultValue] = arg.split('=').map(s => s.trim());
    return {
      name,
      index,
      defaultValue: defaultValue ? JSON.parse(defaultValue) : undefined,
      required: !defaultValue,
    };
  }
  export function createFnMatch<T extends Message>(): (message: T) => string[] | undefined {
    return function (this: FunctionInfo, message: T) {
      let { raw_message, bot } = message;
      if (!raw_message) return;
      if (bot.command_prefix && !raw_message.startsWith(bot.command_prefix)) return;
      raw_message = raw_message.replace(bot.command_prefix || '', '');
      if (!raw_message.startsWith(this.name)) return;
      const execReg = new RegExp(`^${this.name}${this.argsInfo.map(createArgReg).join('')}`, 'm');
      const result = execReg.exec(raw_message);
      if (!result) return;
      return this.argsInfo.map(arg => {
        const value =
          typeof result[arg.index + 1] === 'string' ? result[arg.index + 1].trimStart() : result[arg.index + 1];
        try {
          return value ? JSON.parse(value) : arg.defaultValue;
        } catch {
          return value || arg.defaultValue;
        }
      });
    };
  }
  function createArgReg(argInfo: ArgInfo) {
    return `(\\s"[^"]+?"|\\s'[^']+?'|\\s[^\\s]+?)${argInfo.required ? '' : '?'}`;
  }
}
const functionManager = new FunctionManager();
plugin.mounted(app => {
  plugin.service('functionManager', functionManager);
  plugin.service('functions', functionManager.functions);
  plugin.service('register', functionManager.register);
});
plugin.middleware(async (event, next) => {
  await next();
  return plugin.functionManager.match(event);
});
export default plugin;
