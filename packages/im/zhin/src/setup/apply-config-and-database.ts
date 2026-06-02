import { setLevel } from '@zhin.js/logger';
import { DatabaseFeature } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import { DatabaseLogTransport } from '../log-transport.js';
import { registerUnifiedInbox } from './register-inbox.js';

/**
 * 应用日志级别与数据库配置，注册 DatabaseFeature 及数据库日志输出；
 * 若配置 inbox.enabled，则注册统一收件箱（消息/请求/通知写入内置库）。
 */
export function applyConfigAndDatabase(plugin: Plugin, appConfig: AppConfig): void {
  setLevel(appConfig.log_level);

  if (appConfig.database) {
    plugin.provide(new DatabaseFeature(appConfig.database));
    const logTransport = new DatabaseLogTransport(plugin);
    const logger = plugin.logger as unknown as { transports: unknown[] };
    if (!logger.transports?.some((t: unknown) => t instanceof DatabaseLogTransport)) {
      logger.transports.push(logTransport);
    }
    registerUnifiedInbox(plugin, appConfig);
  }
}
