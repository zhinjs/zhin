import { EventEmitter } from 'events';
import { Logger, getLogger } from 'log4js';
import { Middleware } from './middleware';
import { Plugin, PluginMap } from './plugin';
import { LogLevel } from './types';
import { loadModule } from './utils';
import { remove, sleep } from '@zhinjs/shared';
import { APP_KEY, CONFIG_DIR, serviceCallbacksKey, WORK_DIR } from './constans';
import path from 'path';
import { Adapter } from './adapter';
import { Message } from './message';
import process from 'process';
import { Config } from './config';
import * as fs from 'fs';

export function defineConfig(config: Partial<App.Config>): Partial<App.Config>;
export function defineConfig(
  initialFn: (env: typeof process.env & { mode: string }) => Partial<App.Config>,
): (env: typeof process.env & { mode: string }) => Partial<App.Config>;
export function defineConfig(
  config: Partial<App.Config> | ((env: typeof process.env & { mode: string }) => Partial<App.Config>),
) {
  return config;
}

export class App extends EventEmitter {
  logger: Logger = getLogger(`[zhin]`);
  config: Config;
  middlewares: Middleware<Adapters>[] = [];
  plugins: PluginMap = new PluginMap();
  renders: Message.Render[] = [];
  get adapters() {
    return App.adapters;
  }
  constructor() {
    super();
    this.handleMessage = this.handleMessage.bind(this);
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR);
    this.on('message', this.handleMessage);
    this.config = new Config<App.Config>(process.env.ZHIN_CONFIG || 'zhin.config', App.defaultConfig);
    this.logger.level = this.config.log_level;
    return new Proxy(this, {
      get(target: App, key) {
        if (Reflect.has(target.services, key)) return Reflect.get(target.services, key);
        return Reflect.get(target, key);
      },
    });
  }
  registerRender(render: Message.Render, insertBefore?: boolean) {
    if (insertBefore) this.renders.unshift(render);
    else this.renders.push(render);
    return () => remove(this.renders, render);
  }
  getAdapterSchema(name: string) {
    const adapter = App.adapters.get(name);
    if (!adapter) throw new Error(`cannot find adapter ${name}`);
    return adapter.schemas;
  }
  async renderMessage<T extends Message = Message>(template: string, message?: T) {
    for (const render of this.renders) {
      try {
        template = <string>await render(template, message);
      } catch (e: unknown) {
        return `消息渲染失败:${(e as Error)?.message || '未知错误'}\n${(e as Error)?.stack}`;
      }
    }
    return template;
  }

  initPlugins() {
    const plugins = this.config.plugins;
    for (const plugin of plugins) {
      this.loadPlugin(plugin);
    }
  }

  middleware(middleware: Middleware) {
    this.middlewares.push(middleware);
    return () => {
      remove(this.middlewares, middleware);
    };
  }

  get pluginList() {
    return (
      [...this.plugins.values()]
        // 过滤系统已禁用的插件
        .filter(p => !this.config.disable_plugins.includes(p.id))
        // 按插件优先级进行排序
        .sort((a, b) => {
          return a.priority - b.priority;
        })
    );
  }

  get commandList() {
    return this.pluginList.flatMap(plugin => plugin.commandList);
  }

  get services(): App.Services {
    return this.pluginList.reduce((result, plugin) => {
      plugin.services.forEach((service, name) => {
        if (Reflect.has(result, name)) return;
        Reflect.set(result, name, service);
      });
      return result;
    }, {});
  }

  findCommand(name: string) {
    return this.commandList.find(command => command.name === name);
  }

  getSupportMiddlewares<P extends Adapters>(
    adapter: Adapter<P>,
    bot: Adapter.Bot<P>,
    event: Message<P>,
  ): Middleware<P>[] {
    return (
      this.pluginList
        // 过滤不支持当前适配器的插件
        .filter(plugin => !plugin.adapters || plugin.adapters.includes(adapter.name))
        // 过滤bot禁用的插件
        .filter(plugin => !adapter.botConfig(bot.unique_id)?.disabled_plugins?.includes(plugin.name))
        .reduce(
          (result, plugin) => {
            result.push(...plugin.middlewares);
            return result;
          },
          [...this.middlewares],
        )
    );
  }

  getSupportCommands(adapter: string) {
    return this.pluginList
      .filter(plugin => !plugin.adapters || plugin.adapters.includes(adapter))
      .flatMap(plugin => plugin.commandList);
  }

  handleMessage<P extends Adapters>(adapter: Adapter<P>, bot: Adapter.Bot<P>, event: Message<P>) {
    const middleware = Middleware.compose(this.getSupportMiddlewares(adapter, bot, event));
    middleware(adapter, bot, event);
  }

  plugin(plugin: Plugin): this {
    plugin[APP_KEY] = this;
    this.logger.info(`plugin：${plugin.display_name} loaded。`);
    this.emit('plugin-mounted', plugin);
    return this;
  }

  enable(name: string): this;
  enable(plugin: Plugin): this;
  enable(plugin: Plugin | string) {
    if (typeof plugin === 'string') {
      plugin = this.plugins.get(plugin)!;
      if (!plugin) throw new Error('none plugin：' + plugin);
    }
    if (!Plugin.isPlugin(plugin)) throw new Error(`${plugin} 不是一个有效的插件`);
    if (this.config.disable_plugins.indexOf(plugin.id) >= 0) remove(this.config.disable_plugins, plugin.id);
    return this;
  }

  disable(name: string): this;
  disable(plugin: Plugin): this;
  disable(plugin: Plugin | string) {
    if (typeof plugin === 'string') {
      plugin = this.plugins.get(plugin)!;
      if (!plugin) throw new Error('plugin：' + plugin + 'no init');
    }
    if (!Plugin.isPlugin(plugin)) throw new Error(`${plugin} 不是一个有效的插件`);
    if (!this.config.disable_plugins.includes(plugin.id)) {
      this.config.disable_plugins.push(plugin.id);
    }
    return this;
  }

  emit(event: string, ...args: any[]) {
    const result = super.emit(event, ...args);
    for (const plugin of this.pluginList) {
      plugin.emit(event, ...args);
    }
    return result;
  }

  use(init: Plugin.InstallObject, config?: Plugin.Options): this;
  use(init: Plugin.InstallFn, config?: Plugin.Options): this;
  use(init: Plugin.InstallObject | Plugin.InstallFn, config: Plugin.Options = {}): this {
    let name = typeof init === 'function' ? this.plugins.generateId : (init.name ||= this.plugins.generateId);
    const initFn = typeof init === 'function' ? init : init.install;
    if (!initFn) {
      throw new Error('插件初始化函数不能为空');
    }
    const plugin = new Plugin({
      name,
      ...config,
    });
    this.mount(plugin);
    try {
      initFn(plugin);
      return this;
    } catch (e) {
      this.logger.error(`plugin：${name} init err`, e);
      return this.unmount(plugin);
    }
  }

  mount(name: string): this;
  mount(plugin: Plugin): this;
  mount(entry: Plugin | string) {
    let plugin: Plugin;
    if (Plugin.isPlugin(entry)) plugin = entry;
    else {
      const mod = loadModule<any>(entry);
      if (Plugin.isPlugin(mod)) plugin = mod;
      else plugin = this.plugins.getWithPath(entry)!;
      if (typeof mod === 'function' || typeof mod['install'] === 'function') return this.use(mod);
      if (!plugin) throw new Error(`"${entry}" is not a valid plugin`);
      if (this.plugins.has(plugin.id)) return this;
    }
    this.plugins.set(plugin.id, plugin);
    if (this.config.disable_plugins.indexOf(plugin.id) >= 0) return this.disable(plugin);
    this.plugin(plugin);
    return this;
  }

  unmount(name: string): this;
  unmount(plugin: Plugin): this;
  unmount(plugin: Plugin | string) {
    if (typeof plugin === 'string') {
      plugin = this.plugins.get(plugin)!;
    }
    if (!Plugin.isPlugin(plugin)) {
      this.logger.warn(`${plugin} 不是一个有效的插件，将忽略其卸载。`);
      return this;
    }
    if (!this.plugins.has(plugin.id)) {
      this.logger.warn(`${plugin} 尚未加载，将忽略其卸载。`);
      return this;
    }
    this.emit('plugin-beforeUnmount', plugin);
    this.plugins.delete(plugin.id);
    plugin[APP_KEY] = null;
    for (const [name, service] of plugin.services) {
      this.emit('service-destroy', name, service);
    }
    this.logger.info(`plugin：${plugin.display_name} unmount。`);
    this.emit('plugin-unmounted', plugin);
    return this;
  }
  async start(mode: string = 'prod') {
    this.initPlugins();
    for (const [name, adapter] of App.adapters) {
      const bots = this.config.bots.filter(
        bot => bot?.adapter === adapter.name && !this.config.disable_bots.includes(bot.unique_id),
      );
      adapter.start(this, bots);
      this.logger.mark(`adapter： ${name} started`);
    }
    this.emit('start');
  }

  loadPlugin(name: string): this {
    const maybePath = this.config.plugin_dirs.reduce(
      (result, dir) => {
        result.push(path.resolve(WORK_DIR, dir, name));
        return result;
      },
      [name],
    );
    let loaded: boolean = false,
      error: Error | null = null;
    for (const loadPath of maybePath) {
      if (loaded) break;
      try {
        this.logger.debug(`try load plugin(${name}) from ${loadPath}`);
        this.mount(loadPath);
        loaded = true;
      } catch (e) {
        if (!error || String(Reflect.get(error, 'message')).startsWith('Cannot find')) error = e as Error;
        this.logger.debug(`try load plugin(${name}) failed. (from: ${loadPath})`, (e as Error)?.message || e);
      }
    }
    if (!loaded) this.logger.warn(`load plugin "${name}" failed`, error?.message || error);
    return this;
  }
  async stop() {
    for (const [name, adapter] of App.adapters) {
      adapter.emit('stop');
      this.logger.mark(`adapter： ${name} stopped`);
    }
    this.emit('stop');
    this.logger.info(`process exit after 3 seconds...`);
    await sleep(3000);
    process.exit();
  }
}

export interface App extends App.Services {
  on<T extends keyof App.EventMap>(event: T, listener: App.EventMap[T]): this;

  on<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    listener: (...args: any[]) => any,
  ): this;

  off<T extends keyof App.EventMap>(event: T, callback?: App.EventMap[T]): this;

  off<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    callback?: (...args: any[]) => void,
  ): this;

  once<T extends keyof App.EventMap>(event: T, listener: App.EventMap[T]): this;

  once<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    listener: (...args: any[]) => any,
  ): this;

  emit<T extends keyof App.EventMap>(event: T, ...args: Parameters<App.EventMap[T]>): boolean;

  emit<S extends string | symbol>(event: S & Exclude<string | symbol, keyof App.EventMap>, ...args: any[]): boolean;

  addListener<T extends keyof App.EventMap>(event: T, listener: App.EventMap[T]): this;

  addListener<S extends string | symbol>(
    event: S & Exclude<string | symbol, keyof App.EventMap>,
    listener: (...args: any[]) => any,
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

export function createApp() {
  return new App();
}

export namespace App {
  export const adapters: Map<string, Adapter> = new Map<string, Adapter>();

  export interface EventMap {
    'start'(): void;

    'plugin-mounted'(plugin: Plugin): void;

    'plugin-beforeUnmount'(plugin: Plugin): void;

    'ready'(): void;

    'message': <P extends keyof Adapters>(adapter: Adapter<P>, bot: Adapter.Bot<P>, message: Message<P>) => void;
    'service-register': <T extends keyof App.Services>(name: T, service: App.Services[T]) => void;
    'service-destroy': <T extends keyof App.Services>(name: T, service: App.Services[T]) => void;
  }

  export interface Config {
    has_init?: boolean;
    log_level: LogLevel | string;
    disable_bots: string[];
    disable_plugins: string[];
    plugin_dirs: string[];
    bots: Adapter.BotConfig[];
    plugins: string[];
  }

  export const defaultConfig: Config = {
    log_level: 'info',
    disable_bots: [],
    disable_plugins: [],
    plugin_dirs: [],
    bots: [],
    plugins: [],
  };

  export interface Adapters {
    process: {
      title: string;
    };
  }
  export interface Clients {
    process: NodeJS.Process;
  }
  export interface Services {}
}
export type Adapters = keyof App.Adapters;
