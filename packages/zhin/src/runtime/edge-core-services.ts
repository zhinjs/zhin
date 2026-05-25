import {
  CommandFeature,
  ComponentFeature,
  ConfigFeature,
  CronFeature,
  createMessageDispatcher,
  shouldBindProcessStdin,
  LoginAssist,
  MessageFilterFeature,
  PermissionFeature,
  ProcessAdapter,
  SchemaFeature,
  type Message,
  type Plugin,
} from '@zhin.js/core';
import type { AppConfig } from '../types.js';

/** Edge 运行时核心服务：无 IM connectBots；process 仅本地 TTY 且非 Deploy */
export function registerEdgeCoreServices(
  plugin: Plugin,
  appConfig: AppConfig,
  configFeature: ConfigFeature,
): void {
  const { provide } = plugin;
  provide(configFeature);

  const enabled = new Set(
    appConfig.services ?? ['config', 'command', 'component', 'permission', 'cron'],
  );

  if (enabled.has('process') && shouldBindProcessStdin()) {
    provide({
      name: 'process',
      description: '命令行适配器（本地 TTY）',
      mounted: async (p: Plugin) => {
        const adapter = new ProcessAdapter(p);
        await adapter.start();
        return adapter;
      },
      dispose: async (adapter: ProcessAdapter) => {
        await adapter.stop();
      },
    });
  }

  if (enabled.has('command')) provide(new CommandFeature());
  if (enabled.has('component')) provide(new ComponentFeature());
  if (enabled.has('permission')) provide(new PermissionFeature());
  if (enabled.has('cron')) provide(new CronFeature());

  const filterFeature = new MessageFilterFeature(
    appConfig.message_filter as ConstructorParameters<typeof MessageFilterFeature>[0],
  );
  provide(filterFeature);

  provide(
    createMessageDispatcher({
      dualRoute: appConfig.dispatcher as { mode?: 'exclusive' | 'dual' },
    }),
  );

  plugin.useContext('dispatcher', (dispatcher) => {
    return dispatcher.addGuardrail(async (message: Message<object>, next) => {
      const result = filterFeature.test(message);
      if (result.allowed) await next();
    });
  });

  provide(new SchemaFeature());

  provide({
    name: 'loginAssist',
    description: '登录辅助',
    mounted: async (p: Plugin) => new LoginAssist(p),
    dispose: async (s) => s.dispose(),
  });
}
