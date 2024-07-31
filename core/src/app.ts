import { EventEmitter } from 'events';
import { Logger, getLogger } from 'log4js';
import { Middleware } from './middleware';
import { Plugin, PluginMap } from './plugin';
import { Bot, LogLevel } from './types';
import { loadModule } from './utils';
import { remove, sleep } from '@zhinjs/shared';
import { APP_KEY, CONFIG_DIR, REQUIRED_KEY, WORK_DIR } from './constans';
import path from 'path';
import { Adapter, AdapterBot, AdapterReceive } from './adapter';
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
  adapters: Map<string, Adapter> = new Map<string, Adapter>();
  middlewares: Middleware[] = [];
  plugins: PluginMap = new PluginMap();
  renders: Message.Render[] = [];
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
    const adapter = this.adapters.get(name);
    if (!adapter) throw new Error(`cannot find adapter ${name}`);
    return adapter.schemas;
  }
  async renderMessage<T extends Message = Message>(template: string, message?: T) {
    for (const render of this.renders) {
      try {
        template = <string>await render(template, message);
      } catch (e: unknown) {
        return `消息渲染失败:${(e as Error)?.message || '未知错误'}`;
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

  initAdapter() {
    const adapters = this.config.adapters.filter(adapter => !this.config.disable_adapters.includes(adapter));
    for (const adapter of adapters) {
      this.loadAdapter(adapter);
    }
  }

  middleware<T extends Adapter>(middleware: Middleware<T>) {
    this.middlewares.push(middleware as Middleware);
    return () => {
      remove(this.middlewares, middleware);
    };
  }

  get pluginList() {
    return [...this.plugins.values()]
      .filter(p => !this.config.disable_plugins.includes(p.id))
      .sort((a, b) => {
        return a.priority - b.priority;
      });
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

  getSupportMiddlewares<A extends Adapter>(adapter: A, bot: AdapterBot<A>, event: Message<A>): Middleware[] {
    return this.pluginList
      .filter(plugin => !plugin.adapters || plugin.adapters.includes(adapter.name))
      .reduce(
        (result, plugin) => {
          result.push(...plugin.middlewares);
          return result;
        },
        [...this.middlewares],
      );
  }

  getSupportCommands<A extends Adapter>(adapter: A, bot: Bot<A>, event: Message<A>) {
    return this.pluginList
      .filter(plugin => !plugin.adapters || plugin.adapters.includes(adapter.name))
      .flatMap(plugin => plugin.commandList);
  }

  handleMessage<A extends Adapter>(adapter: A, bot: Adapter.Bot<AdapterBot<A>>, event: Message<A>) {
    const middleware = Middleware.compose(this.getSupportMiddlewares(adapter, bot, event));
    middleware(adapter, bot, event);
  }

  plugin(plugin: Plugin): this {
    this.emit('plugin-beforeMount', plugin);
    plugin[APP_KEY] = this;
    plugin.mounted(() => {
      for (const [name, service] of (plugin as Plugin).services) {
        this.logger.debug(`new service(${name.toString()}) register from from(${plugin.display_name})`);
        this.emit('service-register', name, service);
      }
      this.logger.info(`plugin：${plugin.display_name} loaded。`);
      plugin.isMounted = true;
    });
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
    if (['plugin-beforeMount', 'plugin-mounted', 'plugin-beforeUnmount', 'plugin-unmounted'].includes(event)) {
      const plugin: Plugin = args[0];
      const method = event.split('-')[1];
      if (plugin && plugin?.['lifecycle']?.[method]?.length) {
        for (const lifecycle of plugin['lifecycle'][method]) {
          lifecycle(this);
        }
      }
    }
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
    if (plugin[REQUIRED_KEY].length) {
      const requiredServices = plugin[REQUIRED_KEY];
      const mountFn = () => {
        if (requiredServices.every(key => !!this[key])) {
          this.plugin(plugin);
          this.off('service-register', mountFn);
        }
      };
      const serviceDestroyListener = (name: string) => {
        if (
          requiredServices.some(s => {
            return name === s;
          })
        )
          this.emit('plugin-beforeUnmount', plugin);
      };
      this.on('service-register', mountFn);
      this.on('service-destroy', serviceDestroyListener);
      plugin.beforeUnmount(() => {
        this.off('service-register', mountFn);
        this.off('service-destroy', serviceDestroyListener);
        (plugin as Plugin).isMounted = false;
      });
      mountFn();
    } else {
      this.plugin(plugin);
    }
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
    this.initAdapter();
    for (const [name, adapter] of this.adapters) {
      const bots = this.config.bots.filter(
        bot => bot?.adapter === adapter.name && !this.config.disable_bots.includes(bot.unique_id),
      );
      adapter.emit('start', bots);
      this.logger.mark(`adapter： ${name} started`);
    }
    this.emit('start');
  }

  loadAdapter(name: string) {
    const maybePath = this.config.adapter_dirs.map(dir => {
      return path.resolve(WORK_DIR, dir, name);
    });
    let loaded: boolean = false,
      error: unknown,
      loadName: string = '';
    for (const loadPath of maybePath) {
      if (loaded) break;
      try {
        const adapter = loadModule<any>(loadPath);
        if (!Adapter.isAdapter(adapter)) throw new Error(`${loadPath} is not a valid adapter`);
        this.adapters.set(adapter.name, adapter);
        loadName = adapter.name;
        adapter.mount(this);
        this.logger.debug(`adapter： ${adapter.name} loaded`);
        loaded = true;
      } catch (e) {
        if (!error || String(Reflect.get(error, 'message')).startsWith('Cannot find')) error = e;
        this.logger.debug(`try load adapter(${name}) failed. (from: ${loadPath})`);
        this.logger.trace(e);
        if (loadName) {
          this.adapters.delete(loadName);
          loadName = '';
        }
      }
    }
    if (!loaded) this.logger.warn(`load adapter "${name}" failed`, error);
    return this;
  }

  loadPlugin(name: string): this {
    const maybePath = this.config.plugin_dirs.map(dir => {
      return path.resolve(WORK_DIR, dir, name);
    });
    let loaded: boolean = false,
      error: unknown;
    for (const loadPath of maybePath) {
      if (loaded) break;
      try {
        this.logger.debug(`try load plugin(${name}) from ${loadPath}`);
        this.mount(loadPath);
        loaded = true;
      } catch (e) {
        if (!error || String(Reflect.get(error, 'message')).startsWith('Cannot find')) error = e;
        this.logger.debug(`try load plugin(${name}) failed. (from: ${loadPath})`, e);
      }
    }
    if (!loaded) this.logger.warn(`load plugin "${name}" failed`, error);
    return this;
  }
  async stop() {
    for (const [name, adapter] of this.adapters) {
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

    'plugin-beforeMount'(plugin: Plugin): void;

    'plugin-mounted'(plugin: Plugin): void;

    'plugin-beforeUnmount'(plugin: Plugin): void;

    'plugin-unmounted'(plugin: Plugin): void;

    'ready'(): void;

    'message': <AD extends Adapter>(adapter: AD, bot: AdapterBot<AD>, message: AdapterReceive<AD>) => void;
    'service-register': <T extends keyof App.Services>(name: T, service: App.Services[T]) => void;
    'service-destroy': <T extends keyof App.Services>(name: T, service: App.Services[T]) => void;
  }

  export interface Config {
    has_init?: boolean;
    log_level: LogLevel | string;
    disable_adapters: string[];
    disable_bots: string[];
    disable_plugins: string[];
    adapter_dirs: string[];
    plugin_dirs: string[];
    adapters: string[];
    bots: BotConfig[];
    plugins: string[];
  }

  export const defaultConfig: Config = {
    log_level: 'info',
    disable_adapters: [],
    disable_bots: [],
    disable_plugins: [],
    adapter_dirs: [],
    plugin_dirs: [],
    adapters: [],
    bots: [],
    plugins: [],
  };

  export interface Adapters {
    process: {
      title: string;
    };
  }

  export interface Services {}

  export type BotConfig<T extends keyof Adapters = keyof Adapters> = {
    adapter: T | string;
    unique_id: string;
    master?: string | number;
    admins?: (string | number)[];
    command_prefix?: string;
    forward_length?: number;
    quote_self?: boolean;
  } & Adapters[T];
}
