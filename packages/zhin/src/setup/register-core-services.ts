import {
  ConfigFeature,
  CommandFeature,
  ComponentFeature,
  CronFeature,
  PermissionFeature,
  SkillFeature,
  SchemaFeature,
  MessageFilterFeature,
  createMessageDispatcher,
  ProcessAdapter,
} from '@zhin.js/core';
import type { Plugin, Message } from '@zhin.js/core';
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
      mounted: async (p: Plugin) => {
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

  // 消息过滤引擎
  const filterFeature = new MessageFilterFeature(appConfig.message_filter);
  provide(filterFeature);

  provide(createMessageDispatcher());

  // 将过滤引擎接入 Dispatcher Guardrail（第一阶段拦截）
  plugin.useContext('dispatcher', (dispatcher) => {
    return dispatcher.addGuardrail(async (message: Message<any>, next: () => Promise<void>) => {
      const result = filterFeature.test(message);
      plugin.logger.debug(`消息过滤结果: ${result.allowed ? '允许' : '拒绝'} - ${result.reason || '无理由'}`);
      if (result.allowed) {
        await next();
      }
    });
  });

  provide(new SkillFeature());
  provide(new SchemaFeature());
}
