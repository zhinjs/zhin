import {
  Adapter,
  Adapters,
  App,
  ArgsType,
  Command,
  getCallerStack,
  Message,
  Middleware,
  Plugin,
  WORK_DIR,
} from '@zhinjs/core';
import * as path from 'path';
const setup = new Plugin('setup');
const resolveCallerPlugin = (): [boolean, Plugin] => {
  const callerStack = getCallerStack().map(caller => caller.getFileName());
  const currentIndex = callerStack.indexOf(__filename);
  const filePath = callerStack.slice(currentIndex).find(name => name !== __filename);
  if (!filePath) throw new Error('can not find caller file');
  const fileName = path.basename(filePath);
  if (!setup.app) throw new Error(`please mount "setup" plugin before plugin "${fileName}"`);
  let plugin = setup.app?.plugins.getWithPath(filePath);
  if (plugin) return [false, plugin];
  plugin = new Plugin(fileName);
  plugin.setup = true;
  plugin.filePath = filePath;

  const prefixArr = [
    path.join(__dirname),
    path.join(WORK_DIR, 'node_modules'),
    ...(setup.app?.config.plugin_dirs || []).map(dir => path.resolve(WORK_DIR, dir)),
  ];
  plugin.id = plugin.filePath;
  for (const prefix of prefixArr) {
    plugin.id = plugin.id.replace(`${prefix}${path.sep}`, '');
  }
  plugin.id = plugin.id
    .replace(`${path.sep}index`, '')
    .replace(/\.[cm]?[tj]s$/, '')
    .replace(`${path.sep}lib`, '');
  return [true, plugin];
};
const getOrCreatePlugin = (options?: Plugin.Options) => {
  const [isNew, plugin] = resolveCallerPlugin();
  if (options) {
    for (const key in options) {
      Reflect.set(plugin, key, options[key as keyof Plugin.Options]);
    }
  }
  if (!isNew) {
    return plugin;
  } else {
    setup.app?.plugins.set(plugin.id, plugin);
    setup.app?.plugin(plugin);
    setup.beforeUnmount(() => {
      setup.app?.plugins.delete(plugin.id);
    });
    return plugin;
  }
};
export const context = {
  get plugin() {
    return getOrCreatePlugin();
  },
  command: <S extends Command.Declare>(decl: S, initialValue?: ArgsType<Command.RemoveFirst<S>>) => {
    return context.plugin.command(decl, initialValue);
  },
  service<T extends keyof App.Services>(name: T, service?: App.Services[T]) {
    return context.plugin.service(name, service!);
  },
  require: <T extends keyof App.Services>(...services: T[]) => {
    return context.plugin.required(...services);
  },
  middleware: <AD extends Adapters = Adapters>(middleware: Middleware<AD>) => {
    return context.plugin.middleware(middleware);
  },
  get options(): Plugin.Options {
    return {
      name: context.plugin.name,
      adapters: context.plugin.adapters,
      desc: context.plugin.desc,
      priority: context.plugin.priority,
    };
  },
  set options(options: Plugin.Options) {
    getOrCreatePlugin(options);
  },
  get app() {
    return setup.app;
  },
  pickAdapter(platform: string) {
    return App.adapters.get(platform);
  },
  registerAdapter<P extends Adapters>(platform: P) {
    const adapter = new Adapter<P>(platform);
    context.plugin.adapter(adapter);
    return adapter;
  },
  pickBot: (platform: string, bot_id: string) => {
    return context.pickAdapter(platform)?.pick(bot_id);
  },
  sendGroupMessage: (platform: string, bot_id: string, group_id: string, message: string, source?: Message) => {
    return context.pickAdapter(platform)?.sendMsg(bot_id, `group:${group_id}`, message, source);
  },
  sendPrivateMessage: (platform: string, bot_id: string, user_id: string, message: string, source?: Message) => {
    return context.pickAdapter(platform)?.sendMsg(bot_id, `private:${user_id}`, message, source);
  },
  sendGuildMessage: (platform: string, bot_id: string, channel_id: string, message: string, source?: Message) => {
    return context.pickAdapter(platform)?.sendMsg(bot_id, `guild:${channel_id}`, message, source);
  },
  sendDirectMessage: (platform: string, bot_id: string, guild_id: string, message: string, source?: Message) => {
    return context.pickAdapter(platform)?.sendMsg(bot_id, `direct:${guild_id}`, message, source);
  },
  onMount: (callback: Plugin.CallBack) => {
    setup.mounted(callback);
    if (setup.isMounted) callback(setup.app!);
    return context;
  },
  onUnmount: (callback: Plugin.CallBack) => {
    const plugin = getOrCreatePlugin();
    plugin.unmounted(callback);
    if (!plugin.isMounted) callback(setup.app!);
    return context;
  },
  listen: <E extends keyof App.EventMap>(event: E, callback: App.EventMap[E]) => {
    const plugin = getOrCreatePlugin();
    plugin.on(event, callback);
    return context;
  },
};
export const getAdapter = context.pickAdapter;
export const registerAdapter = context.registerAdapter;
export const getBot = context.pickBot;
export const registerMiddleware = context.middleware;
export const useCommand = context.command;
export const withService = context.require;
export const registerService = context.service;
export const sendGroupMessage = context.sendGroupMessage;
export const sendPrivateMessage = context.sendPrivateMessage;
export const sendGuildMessage = context.sendGuildMessage;
export const sendDirectMessage = context.sendDirectMessage;
export const onMount = context.onMount;
export const onUnmount = context.onUnmount;
export const listen = context.listen;
export const defineMetadata = (metadata: Plugin.Options) => {
  return getOrCreatePlugin(metadata);
};
export default setup;
