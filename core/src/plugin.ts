import { ArgsType, Command, defineCommand } from './command';
import { EventEmitter } from 'events';
import { Middleware } from './middleware';
import { getCallerStack, remove } from './utils';
import { App } from './app';
import { APP_KEY, REQUIRED_KEY, WORK_DIR } from './constans';
import { Dict } from './types';
import path from 'path';
import { Adapter } from './adapter';
import process from 'process';
import * as fs from 'fs';

export interface Plugin extends Plugin.Options {}

export class Plugin extends EventEmitter {
  public id: string;
  public name: string = '';
  disposes: Function[] = [];
  priority: number;
  isMounted: boolean = false;
  [REQUIRED_KEY]: (keyof App.Services)[] = [];
  filePath: string;
  setup: boolean = false;
  private lifecycle: Dict<Plugin.CallBack[]> = {};
  public adapters?: string[] = [];
  get status(): Plugin.Status {
    return this.isMounted && !this.app!.config.disable_plugins.includes(this.id) ? 'enabled' : 'disabled';
  }
  services: Map<string | symbol, any> = new Map<string | symbol, any>();
  commands: Map<string, Command> = new Map<string, Command>();
  middlewares: Middleware[] = [];
  [APP_KEY]: App | null = null;

  get app() {
    return this[APP_KEY];
  }

  get display_name() {
    return this.name || this.id;
  }

  set display_name(name: string) {
    this.name = name;
  }

  get statusText() {
    return Plugin.StatusText[this.status];
  }

  get commandList() {
    const commandList = [...this.commands.values()];
    return commandList.reduce((result, command) => {
      result.push(...command.deepChildren);
      return result;
    }, commandList);
  }

  constructor(name?: string);
  constructor(options?: Plugin.Options);
  constructor(param: Plugin.Options | string = {}) {
    super();
    const options: Plugin.Options =
      typeof param === 'string'
        ? {
            name: param,
          }
        : param;
    this.adapters = options.adapters;
    this.priority = options.priority || 1;
    this.desc = options.desc || '';
    const stack = getCallerStack();
    stack.shift(); // 排除当前文件调用
    this.filePath = stack[0]?.getFileName()!;
    this.name = options.name!;
    const prefixArr = [
      path.join(WORK_DIR, 'node_modules'),
      WORK_DIR,
      path.resolve(__dirname, '../../zhin/src/plugins'),
    ];
    this.id = this.filePath;
    for (const prefix of prefixArr) {
      this.id = this.id.replace(`${prefix}${path.sep}`, '');
    }
    const reg = new RegExp(`${path.sep}lib${path.sep}index\\.[cm][tj]s$`);
    if (reg.test(this.id) && fs.existsSync(path.resolve(this.id.replace(reg, ''), 'package.json'))) {
      this.id = require(path.resolve(this.id.replace(reg, ''), 'package.json')).name;
    } else {
      this.id = this.id
        .replace(`${path.sep}index`, '')
        .replace(/\.[cm]?[tj]s$/, '')
        .replace(`${path.sep}lib`, '');
    }
    return new Proxy(this, {
      get(target: Plugin, key) {
        if (!target.app || Reflect.has(target, key)) return Reflect.get(target, key);
        return Reflect.get(target.app.services, key);
      },
    });
  }

  required<T extends keyof App.Services>(...services: (keyof App.Services)[]) {
    this[REQUIRED_KEY].push(...services);
  }

  service<T extends keyof App.Services>(name: T): App.Services[T];
  service<T extends keyof App.Services>(name: T, service: App.Services[T]): this;
  service<T extends keyof App.Services>(name: T, service?: App.Services[T]) {
    if (!service) return this.app!.services[name];
    this.services.set(name, service);
    if (this.isMounted) {
      this.app!.logger.debug(`new service(${name}) register from plugin(${this.display_name})`);
      this.app!.emit('service-register', name, service);
    }
    return this;
  }
  middleware<AD extends Adapter = Adapter>(middleware: Middleware<AD>, before?: boolean) {
    const method: 'push' | 'unshift' = before ? 'unshift' : 'push';
    this.middlewares[method](middleware as Middleware);
    this.disposes.push(() => remove(this.middlewares, middleware));
    return this;
  }

  plugin(name: string) {
    const filePath = path.resolve(this.filePath, name);
    this.app?.once('plugin-mounted', p => {
      this.disposes.push(() => {
        this.app?.unmount(p.id);
      });
    });
    this.app?.mount(filePath);
    return this;
  }

  // @ts-ignore
  command<S extends Command.Declare>(
    decl: S,
    initialValue?: ArgsType<Command.RemoveFirst<S>>,
  ): Command<ArgsType<Command.RemoveFirst<S>>>;
  command<S extends Command.Declare>(decl: S, config?: Command.Config): Command<ArgsType<Command.RemoveFirst<S>>>;
  command<S extends Command.Declare>(
    decl: S,
    initialValue?: ArgsType<Command.RemoveFirst<S>>,
    config?: Command.Config,
  ): Command<ArgsType<Command.RemoveFirst<S>>>;
  command<S extends Command.Declare>(decl: S, ...args: (ArgsType<Command.RemoveFirst<S>> | Command.Config)[]) {
    const [nameDecl, ...argsDecl] = decl.split(/\s+/);
    if (!nameDecl) throw new Error('nameDecl不能为空');
    const nameArr = nameDecl.split('.').filter(Boolean);
    let name = nameArr.pop();
    let parent: Command | undefined;
    while (nameArr.length) {
      parent = this.findCommand(nameArr.shift()!);
      if (!parent) throw new Error(`找不到父指令:${nameArr.join('.')}`);
    }
    const command = defineCommand(argsDecl.join(' '), ...(args as any));
    if (parent) {
      command.parent = parent;
      parent.children.push(command as unknown as Command);
    }
    command.name = name;
    this.commands.set(name!, command);
    this.emit('command-add', command);
    this.disposes.push(() => {
      this.commands.delete(name!);
      this.emit('command-remove', command);
    });
    return command as unknown as Command<ArgsType<Command.RemoveFirst<S>>>;
  }

  /**
   * 查找指定名称的指令
   * @param name 指令名
   */
  findCommand(name: string) {
    return this.commandList.find(command => command.name === name);
  }

  mounted(callback: Plugin.CallBack) {
    const lifeCycles = (this.lifecycle['mounted'] ||= []);
    lifeCycles.push(callback);
  }

  beforeMount(callback: Plugin.CallBack) {
    const lifeCycles = this.lifecycle['beforeMount'] || [];
    lifeCycles.push(callback);
  }

  unmounted(callback: Plugin.CallBack) {
    const lifeCycles = this.lifecycle['unmounted'] || [];
    lifeCycles.push(callback);
  }

  beforeUnmount(callback: Plugin.CallBack) {
    const lifeCycles = this.lifecycle['beforeUnmount'] || [];
    lifeCycles.push(callback);
  }
}

export interface Plugin extends App.Services {
  on<T extends keyof App.EventMap>(event: T, callback: App.EventMap[T]): this;

  on<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback: (...args: any[]) => void,
  ): this;

  once<T extends keyof App.EventMap>(event: T, callback: App.EventMap[T]): this;

  once<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback: (...args: any[]) => void,
  ): this;

  off<T extends keyof App.EventMap>(event: T, callback?: App.EventMap[T]): this;

  off<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback?: (...args: any[]) => void,
  ): this;

  emit<T extends keyof App.EventMap>(event: T, ...args: Parameters<App.EventMap[T]>): boolean;

  emit<S extends string | symbol>(event: S & Exclude<string | symbol, keyof App.EventMap>, ...args: any[]): boolean;

  addListener<T extends keyof App.EventMap>(event: T, callback: App.EventMap[T]): this;

  addListener<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback: (...args: any[]) => void,
  ): this;

  addListenerOnce<T extends keyof App.EventMap>(event: T, callback: App.EventMap[T]): this;

  addListenerOnce<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback: (...args: any[]) => void,
  ): this;

  removeListener<T extends keyof App.EventMap>(event: T, callback?: App.EventMap[T]): this;

  removeListener<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback?: (...args: any[]) => void,
  ): this;

  removeAllListeners<T extends keyof App.EventMap>(event: T): this;

  removeAllListeners<S extends string | symbol>(event: S & Exclude<string | symbol, keyof App.EventMap>): this;
}

export namespace Plugin {
  export type CallBack = (app: App) => any;

  export interface Options {
    /**
     * 插件名称
     */
    name?: string;
    /**
     * 支持的适配器
     */
    adapters?: string[];
    /**
     * 插件描述
     */
    desc?: string;
    /**
     * 匹配优先级
     */
    priority?: number;
  }

  export type Status = 'enabled' | 'disabled';

  export enum StatusText {
    enabled = '✅',
    disabled = '❌',
  }

  export type InstallObject = {
    name?: string;
    install: InstallFn;
  };
  export type InstallFn = (plugin: Plugin) => void;
  export type BuiltPlugins = 'commandParser' | 'guildManager' | 'hmr' | 'pluginManager';
}

export class PluginMap extends Map<string, Plugin> {
  private get anonymousCount() {
    return [...this.keys()].filter(name => name.startsWith(`anonymous_`)).length;
  }

  getWithPath(filePath: string) {
    for (const [_, plugin] of this) {
      const result = plugin.filePath.replace(filePath, '');
      if (!result || ['.ts', '.js', '.cjs', '.mts'].includes(result)) return plugin;
    }
  }

  get generateId() {
    for (let i = 0; i < this.anonymousCount; i++) {
      if (!this.has(`anonymous_${i}`)) return `anonymous_${i}`;
    }
    return `anonymous_${this.anonymousCount}`;
  }
}
