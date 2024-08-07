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
export const useContext = {
  command<S extends Command.Declare>(decl: S, initialValue?: ArgsType<Command.RemoveFirst<S>>) {
    const plugin = getOrCreatePlugin();
    return plugin.command(decl, initialValue);
  },
  required<T extends keyof App.Services>(...services: T[]) {
    const plugin = getOrCreatePlugin();
    return plugin.required(...services);
  },
  middleware<AD extends Adapter = Adapter>(middleware: Middleware<AD>) {
    const plugin = getOrCreatePlugin();
    plugin.middleware(middleware);
    return this;
  },
  get plugin() {
    return getOrCreatePlugin();
  },
  adapter(platform: string) {
    return setup.app?.adapters.get(platform);
  },
  bot(platform: string, bot_id: string) {
    return this.adapter(platform)?.pick(bot_id);
  },
  sendGroupMessage(platform: string, bot_id: string, group_id: string, message: string, source?: Message) {
    return this.adapter(platform)?.sendMsg(bot_id, group_id, 'group', message, source);
  },
  sendPrivateMessage(platform: string, bot_id: string, user_id: string, message: string, source?: Message) {
    return this.adapter(platform)?.sendMsg(bot_id, user_id, 'private', message, source);
  },
  sendGuildMessage(platform: string, bot_id: string, channel_id: string, message: string, source?: Message) {
    return this.adapter(platform)?.sendMsg(bot_id, channel_id, 'guild', message, source);
  },
  sendDirectMessage(platform: string, bot_id: string, guild_id: string, message: string, source?: Message) {
    return this.adapter(platform)?.sendMsg(bot_id, guild_id, 'direct', message, source);
  },
  onMount(callback: Plugin.CallBack) {
    setup.mounted(callback);
    if (setup.isMounted) callback(setup.app!);
    return this;
  },
  onUnmount(callback: Plugin.CallBack) {
    const plugin = getOrCreatePlugin();
    plugin.unmounted(callback);
    if (!plugin.isMounted) callback(setup.app!);
    return this;
  },
  options(options: Plugin.Options) {
    getOrCreatePlugin(options);
  },
  listen<E extends keyof App.EventMap>(event: E, callback: App.EventMap[E]) {
    const plugin = getOrCreatePlugin();
    plugin.on(event, callback);
    return this;
  },
};
export const getAdapter = useContext.adapter.bind(useContext);
export const getBot = useContext.bot.bind(useContext);
export const registerMiddleware = useContext.middleware.bind(useContext);
export const registerCommand = useContext.command.bind(useContext);
export const sendGroupMessage = useContext.sendGroupMessage.bind(useContext);
export const sendPrivateMessage = useContext.sendPrivateMessage.bind(useContext);
export const sendGuildMessage = useContext.sendGuildMessage.bind(useContext);
export const sendDirectMessage = useContext.sendDirectMessage.bind(useContext);
export const onMount = useContext.onMount.bind(useContext);
export const onUnmount = useContext.onUnmount.bind(useContext);
export const listenEvent = useContext.listen.bind(useContext);
export const definePluginOptions = useContext.options.bind(useContext);
export const withService = useContext.required.bind(useContext);
export default setup;
