import {
  ConfigFeature,
  CommandFeature,
  ComponentFeature,
  CronFeature,
  PermissionFeature,
  SkillFeature,
  createMessageDispatcher,
  ProcessAdapter,
} from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';

/**
 * 注册配置服务（必须）及按配置注册可选服务：process / command / component / permission / cron / dispatcher / skill
 */
export function registerCoreServices(
  plugin: Plugin,
  appConfig: AppConfig,
  configFeature: ConfigFeature,
): void {
  const { provide } = plugin;
  provide(configFeature);

  const enabledServices = new Set(
    appConfig.services || ['process', 'config', 'command', 'component', 'permission', 'cron'],
  );

  if (enabledServices.has('process')) {
    provide({
      name: 'process',
      description: '命令行适配器',
      mounted: async (p) => {
        const adapter = new ProcessAdapter(p);
        await adapter.start();
        return adapter;
      },
      dispose: async (adapter) => {
        await adapter.stop();
      },
    });
  }

  if (enabledServices.has('command')) provide(new CommandFeature());
  if (enabledServices.has('component')) provide(new ComponentFeature());
  if (enabledServices.has('permission')) provide(new PermissionFeature());
  if (enabledServices.has('cron')) provide(new CronFeature());

  provide(createMessageDispatcher());
  provide(new SkillFeature());
}
