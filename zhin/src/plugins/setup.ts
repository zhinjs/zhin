import { Adapter, App, ArgsType, Command, getCallerStack, Message, Middleware, Plugin, WORK_DIR } from '@zhinjs/core';
import * as path from 'path';
const setup = new Plugin('setup');
const resolveCallerPlugin = (): [boolean, Plugin] => {
  const callerStack = getCallerStack().map(caller => caller.getFileName());
  callerStack.shift();
  callerStack.shift();
  callerStack.shift();
  const filePath = callerStack.shift()!;
  const fileName = path.basename(filePath);
  let plugin = setup.app!.plugins.getWithPath(filePath);
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
    setup.app!.plugins.set(plugin.id, plugin);
    setup.app!.plugin(plugin);
    setup.beforeUnmount(() => {
      setup.app!.plugins.delete(plugin.id);
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
  service: <T extends keyof App.Services>(...services: T[]) => {
    return context.plugin.required(...services);
  },
  middleware: <AD extends Adapter = Adapter>(middleware: Middleware<AD>) => {
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
  adapter(platform: string) {
    return setup.app?.adapters.get(platform);
  },
  pickBot: (platform: string, bot_id: string) => {
    return context.adapter(platform)?.pick(bot_id);
  },
  sendGroupMessage: (platform: string, bot_id: string, group_id: string, message: string, source?: Message) => {
    return context.adapter(platform)?.sendMsg(bot_id, group_id, 'group', message, source);
  },
  sendPrivateMessage: (platform: string, bot_id: string, user_id: string, message: string, source?: Message) => {
    return context.adapter(platform)?.sendMsg(bot_id, user_id, 'private', message, source);
  },
  sendGuildMessage: (platform: string, bot_id: string, channel_id: string, message: string, source?: Message) => {
    return context.adapter(platform)?.sendMsg(bot_id, channel_id, 'guild', message, source);
  },
  sendDirectMessage: (platform: string, bot_id: string, guild_id: string, message: string, source?: Message) => {
    return context.adapter(platform)?.sendMsg(bot_id, guild_id, 'direct', message, source);
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
export const getAdapter = context.adapter;
export const getBot = context.pickBot;
export const useMiddleware = context.middleware;
export const useCommand = context.command;
export const withService = context.service;
export const sendGroupMessage = context.sendGroupMessage;
export const sendPrivateMessage = context.sendPrivateMessage;
export const sendGuildMessage = context.sendGuildMessage;
export const sendDirectMessage = context.sendDirectMessage;
export const onMount = context.onMount;
export const onUnmount = context.onUnmount;
export const listen = context.listen;
export const setOptions = (options: Plugin.Options) => {
  return getOrCreatePlugin(options);
};
export default setup;
