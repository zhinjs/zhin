import { Adapter, Adapters, App, ArgsType, Command, getCallerStack, Message, Middleware, Plugin } from '@zhinjs/core';
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
export interface Context {
  get plugin(): Plugin;
  command<A extends any[] = [], O = {}>(command: Command<A, O>): Plugin;
  command<S extends Command.Declare>(
    decl: S,
    initialValue?: ArgsType<Command.RemoveFirst<S>>,
  ): Command<ArgsType<Command.RemoveFirst<S>>>;
  command<S extends Command.Declare>(decl: S, config?: Command.Config): Command<ArgsType<Command.RemoveFirst<S>>>;
  command<S extends Command.Declare>(
    decl: S,
    initialValue: ArgsType<Command.RemoveFirst<S>>,
    config?: Command.Config,
  ): Command<ArgsType<Command.RemoveFirst<S>>>;
  provide<T extends keyof App.Services>(name: T, service: App.Services[T]): Plugin;
  inject<T extends keyof App.Services>(name: T): App.Services[T];
  waitServices<T extends keyof App.Services>(...args: [...T[], callabck: (app: App) => void]): void;
  middleware<AD extends Adapters = Adapters>(middleware: Middleware<AD>): Plugin;
  options: Plugin.Options;
  get app(): App | null;
  pickAdapter<P extends Adapters>(platform: P): Adapter<P> | undefined;
  registerAdapter<P extends Adapters>(platform: P): Adapter<P>;
  pickBot<P extends Adapters>(platform: P, bot_id: string): Adapter.Bot<P> | undefined;
  sendGroupMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    group_id: string,
    message: string,
    source?: Message,
  ): Promise<any>;
  sendPrivateMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    user_id: string,
    message: string,
    source?: Message,
  ): Promise<any>;
  sendGuildMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    channel_id: string,
    message: string,
    source?: Message,
  ): Promise<any>;
  sendDirectMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    guild_id: string,
    message: string,
    source?: Message,
  ): Promise<any>;
  onMount(callback: Plugin.CallBack): Plugin;
  onUnmount(callback: Plugin.CallBack): Plugin;
  listen<E extends keyof App.EventMap>(event: E, callback: App.EventMap[E]): Plugin;
}
export const context = {
  get plugin() {
    return getOrCreatePlugin();
  },
  command<S extends Command.Declare>(
    decl: S | Command,
    ...args: [(ArgsType<S> | Command.Config)?] | [ArgsType<S>, Command.Config?]
  ) {
    return context.plugin.command(decl as string, ...(args as any[]));
  },
  provide<T extends keyof App.Services>(name: T, service: App.Services[T]) {
    return context.plugin.service(name, service);
  },
  inject<T extends keyof App.Services>(name: T) {
    return context.plugin.service(name);
  },
  waitServices<T extends keyof App.Services>(...args: [...T[], callabck: (app: App) => void]) {
    return context.plugin.waitServices(...args);
  },
  middleware<AD extends Adapters = Adapters>(middleware: Middleware<AD>) {
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
  pickAdapter<P extends Adapters>(platform: P) {
    return App.adapters.get(platform);
  },
  registerAdapter<P extends Adapters>(platform: P) {
    const adapter = new Adapter<P>(platform);
    context.plugin.adapter(adapter);
    return adapter;
  },
  pickBot<P extends Adapters>(platform: P, bot_id: string) {
    return context.pickAdapter(platform)?.pick(bot_id);
  },
  sendGroupMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    group_id: string,
    message: string,
    source?: Message<P>,
  ) {
    return context.pickBot(platform, bot_id)?.sendMsg(`group:${group_id}`, message, source);
  },
  sendPrivateMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    user_id: string,
    message: string,
    source?: Message<P>,
  ) {
    return context.pickBot(platform, bot_id)?.sendMsg(`private:${user_id}`, message, source);
  },
  sendGuildMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    channel_id: string,
    message: string,
    source?: Message<P>,
  ) {
    return context.pickBot(platform, bot_id)?.sendMsg(`guild:${channel_id}`, message, source);
  },
  sendDirectMessage<P extends Adapters>(
    platform: P,
    bot_id: string,
    guild_id: string,
    message: string,
    source?: Message<P>,
  ) {
    return context.pickBot(platform, bot_id)?.sendMsg(`direct:${guild_id}`, message, source);
  },
  onMount(callback: Plugin.CallBack) {
    setup.mounted(callback);
    if (setup.isMounted) callback(setup.app!);
    return context;
  },
  onUnmount(callback: Plugin.CallBack) {
    const plugin = getOrCreatePlugin();
    plugin.beforeUnmount(callback);
    if (!plugin.isMounted) callback(setup.app!);
    return context;
  },
  listen<E extends keyof App.EventMap>(event: E, callback: App.EventMap[E]) {
    const plugin = getOrCreatePlugin();
    plugin.on(event, callback);
    return context;
  },
} as unknown as Context;
export const getAdapter = context.pickAdapter;
export const registerAdapter = context.registerAdapter;
export const getBot = context.pickBot;
export const registerMiddleware = context.middleware;
export const useCommand = context.command;
export const waitServices = context.waitServices;
export const provide = context.provide;
export const inject = context.inject;
export const sendGroupMessage = context.sendGroupMessage;
export const sendPrivateMessage = context.sendPrivateMessage;
export const sendGuildMessage = context.sendGuildMessage;
export const sendDirectMessage = context.sendDirectMessage;
export const onMount = context.onMount;
export const onUnmount = context.onUnmount;
export const listen = context.listen;
export const logger = {
  trace(message: any, ...args: any[]): void {
    context.plugin.logger.debug(message, ...args);
  },
  debug(message: any, ...args: any[]): void {
    context.plugin.logger.debug(message, ...args);
  },
  info(message: any, ...args: any[]): void {
    context.plugin.logger.info(message, ...args);
  },
  warn(message: any, ...args: any[]): void {
    context.plugin.logger.warn(message, ...args);
  },
  error(message: any, ...args: any[]): void {
    context.plugin.logger.error(message, ...args);
  },
  fatal(message: any, ...args: any[]): void {
    context.plugin.logger.fatal(message, ...args);
  },
  mark(message: any, ...args: any[]): void {
    context.plugin.logger.mark(message, ...args);
  },
};
export const defineMetadata = (metadata: Plugin.Options) => {
  return getOrCreatePlugin(metadata);
};
export default setup;
