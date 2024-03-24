import { EventEmitter } from 'events';
import { Logger, getLogger } from 'log4js';
import { Middleware } from './middleware';
import { Plugin, PluginMap } from './plugin';
import { Bot, Dict, LogLevel } from './types';
import { deepMerge, loadModule, remove } from './utils';
import { APP_KEY, REQUIRED_KEY, WORK_DIR } from './constans';
import path from 'path';
import { Adapter, AdapterBot, AdapterReceive } from './adapter';
import { Message } from './message';
import process from 'process';
import { JsonDB } from './db';
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
  adapters: Map<string, Adapter> = new Map<string, Adapter>();
  middlewares: Middleware[] = [];
  plugins: PluginMap = new PluginMap();
  renders: Message.Render[] = [];
  #db: JsonDB;
  constructor(public config: App.Config) {
    super();
    this.logger.level = config.logLevel;
    this.handleMessage = this.handleMessage.bind(this);
    this.on('message', this.handleMessage);
    this.#db = new JsonDB(path.join(WORK_DIR, 'data', 'zhin.jsondb'));
    return new Proxy(this, {
      get(target: App, key) {
        if (Reflect.has(target.services, key)) return Reflect.get(target.services, key);
        return Reflect.get(target, key);
      },
    });
  }

  registerRender(render: Message.Render) {
    this.renders.push(render);
    return () => remove(this.renders, render);
  }

  async renderMessage<T extends Message = Message>(template: string, message?: T) {
    for (const render of this.renders) {
      try {
        template = await render(template, message);
      } catch {}
    }
    return template;
  }
  initPlugins(pluginConfig: App.Config['plugins']) {
    const plugins = Array.isArray(pluginConfig)
      ? pluginConfig
          .map(item => {
            if (item instanceof Plugin) return item;
            return {
              name: typeof item === 'string' ? item : item.name,
              install: typeof item !== 'string' ? (typeof item === 'function' ? item : item.install) : undefined,
              enable: true,
            };
          })
          .filter(Boolean)
      : Object.entries(this.config.plugins).map(([name, info]) => {
          return {
            name,
            install: typeof info !== 'boolean' ? (typeof info === 'function' ? info : info.install) : undefined,
            enable: typeof info === 'boolean' ? info : true,
          };
        });
    for (const plugin of plugins) {
      if (plugin instanceof Plugin) {
        this.mount(plugin);
      } else if (!plugin?.install) {
        this.loadPlugin(plugin.name!);
      } else {
        this.use(plugin as Plugin.InstallObject);
      }
      if (!plugin.enable) this.disable(plugin.name!);
    }
  }
  initAdapter(adapters: Adapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.name, adapter);
      try {
        const bots = (this.config.bots ||= []).filter(bot => bot.adapter === adapter.name);
        adapter.mount(this, bots);
        this.logger.debug(`adapter： ${adapter.name} loaded`);
      } catch (e) {
        this.logger.error(`adapter： ${adapter.name} load err`, e);
        this.adapters.delete(adapter.name);
      }
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
      .filter(p => p.status === 'enabled')
      .sort((a, b) => {
        return a.priority - b.priority;
      });
  }

  get commandList() {
    return this.pluginList.flatMap(plugin => plugin.commandList);
  }

  get services() {
    let result: App.Services = {
      jsondb: this.#db,
    };
    this.pluginList.forEach(plugin => {
      plugin.services.forEach((service, name) => {
        if (Reflect.ownKeys(result).includes(name)) return;
        Reflect.set(result, name, service);
      });
    });
    return result;
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
    });
    this.emit('plugin-mounted', plugin);
    plugin.isMounted = true;
    return this;
  }
  enable(name: string): this;
  enable(plugin: Plugin): this;
  enable(plugin: Plugin | string) {
    if (typeof plugin === 'string') {
      plugin = this.plugins.get(plugin)!;
      if (!plugin) throw new Error('none plugin：' + plugin);
    }
    if (!(plugin instanceof Plugin)) throw new Error(`${plugin} 不是一个有效的插件`);
    plugin.status = 'enabled';
    return this;
  }

  disable(name: string): this;
  disable(plugin: Plugin): this;
  disable(plugin: Plugin | string) {
    if (typeof plugin === 'string') {
      plugin = this.plugins.get(plugin)!;
      if (!plugin) throw new Error('plugin：' + plugin + 'no init');
    }
    if (!(plugin instanceof Plugin)) throw new Error(`${plugin} 不是一个有效的插件`);
    plugin.status = 'disabled';
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
    if (entry instanceof Plugin) plugin = entry;
    else {
      const mod = loadModule<any>(entry);
      if (mod instanceof Plugin) plugin = mod;
      else plugin = this.plugins.getWithPath(entry)!;
      if (typeof mod === 'function' || typeof mod['install'] === 'function') return this.use(mod);
      if (!plugin) throw new Error(`"${entry}" is not a valid plugin`);
      if (this.plugins.has(plugin.name)) return this;
    }
    const userPluginDirs = (this.config.pluginDirs || []).map(dir => path.resolve(WORK_DIR, dir));
    for (const pluginDir of userPluginDirs) {
      plugin.name = plugin.name.replace(`${pluginDir}${path.sep}`, '');
    }
    this.plugins.set(plugin.name, plugin);
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
    if (!(plugin instanceof Plugin)) {
      this.logger.warn(`${plugin} 不是一个有效的插件，将忽略其卸载。`);
      return this;
    }
    if (!this.plugins.has(plugin.name)) {
      this.logger.warn(`${plugin} 尚未加载，将忽略其卸载。`);
      return this;
    }
    this.emit('plugin-beforeUnmount', plugin);
    this.plugins.delete(plugin.name);
    plugin[APP_KEY] = null;
    for (const [name, service] of plugin.services) {
      this.emit('service-destroy', name, service);
    }
    this.logger.info(`plugin：${plugin.display_name} unmount。`);
    this.emit('plugin-unmounted', plugin);
    return this;
  }

  async start() {
    this.initPlugins(this.config.plugins);
    this.initAdapter((this.config.adapters ||= []));
    for (const [name, adapter] of this.adapters) {
      adapter.emit('start');
      this.logger.mark(`adapter： ${name} started`);
    }
    this.emit('start');
  }

  loadPlugin(name: string): this {
    const maybePath = [
      ...(this.config.pluginDirs || []).map(dir => {
        return path.resolve(WORK_DIR, dir, name);
      }), // 用户自己的插件
      path.resolve(__dirname, 'plugins', name), // 内置插件
      path.resolve(WORK_DIR, 'node_modules', name), //社区插件
    ];
    let loaded: boolean = false,
      error: unknown;
    for (const loadPath of maybePath) {
      if (loaded) break;
      try {
        this.mount(loadPath);
        loaded = true;
      } catch (e) {
        if (!error || String(Reflect.get(error, 'message')).startsWith('Cannot find')) error = e;
        this.logger.debug(`try load plugin(${name}) failed. (from: ${loadPath})`);
      }
    }
    if (!loaded) this.logger.warn(`load plugin "${name}" failed`, error);
    return this;
  }

  stop() {}
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
export function createApp(options: Partial<App.Config>) {
  return new App(deepMerge(options, App.defaultConfig) as App.Config);
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
    logLevel: LogLevel | string;
    adapters: Adapter[];
    pluginDirs?: string[];
    bots: BotConfig[];
    plugins:
      | (string | Plugin.InstallObject | Plugin | Plugin.InstallFn)[]
      | Dict<boolean | Plugin.InstallObject | Plugin.InstallFn>;
  }
  export const defaultConfig: Config = {
    logLevel: 'info',
    adapters: [],
    bots: [],
    plugins: [],
    pluginDirs: [],
  };
  export interface Adapters {
    process: {
      title: string;
    };
  }
  export interface Services {
    jsondb: JsonDB;
  }
  export type BotConfig<T extends keyof Adapters = keyof Adapters> =
    | ({
        adapter: T | string;
      } & Adapters[T])
    | Dict;
}
