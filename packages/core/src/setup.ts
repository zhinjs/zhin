/**
 * Worker 入口 - 基于 zhinjs/next 设计
 * 直接使用 usePlugin() 作为入口，移除 App 类
 */

import { setLevel, LogLevel } from '@zhin.js/logger';
import { usePlugin } from './plugin.js';
import { ConfigService } from './built/config.js';
import { PermissionService } from './built/permission.js';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from './types.js';
import { MessageCommand } from './command.js';
import { CommandService } from './built/command.js';
import { ProcessAdapter } from './built/adapter-process.js';
import { Registry, Database } from "@zhin.js/database";
import { Models } from './types.js';
import { SystemLogDefinition } from './models/system-log.js';
import { UserDefinition } from './models/user.js';


const {
  useContext, addCommand, provide,
  start, stop, watch,
  logger, children,
  import: importPlugin } = usePlugin();
// 1. 加载服务插件
provide({
  name: 'process',
  description: 'Process Adapter',
  mounted: async (plugin) => {
      const adapter = new ProcessAdapter(plugin)
      await adapter.start()
      return adapter
  },
  dispose: async (adapter) => {
      await adapter.stop()
  }
})
// 创建并注册配置服务
provide({
  name: 'config',
  description: '配置服务',
  mounted: async () => {
    const config = new ConfigService()
    await config.load('zhin.config.yml', {
      log_level: LogLevel.INFO,
      database: {
        dialect: "sqlite",
        filename: "./data/test.db"
      },
      plugin_dirs: [path.relative(process.cwd(), import.meta.dirname), 'node_modules/@zhin.js', './plugins',],
      plugins: [],
    })
    return config
  }
});
provide({
  name: 'command',
  description: '命令服务',
  value: new CommandService()
});
provide({
  name: 'permission',
  description: '权限管理',
  value: new PermissionService()
});

useContext('config', async (service) => {
  const config = service.getData<AppConfig>('zhin.config.yml');
  // 4. 设置日志级别
  setLevel(config.log_level || LogLevel.INFO);
  if (config.database) {
    const { dialect, ...rest } = config.database
    const db = Registry.create<Models, typeof dialect>(dialect, rest, {
      SystemLog: SystemLogDefinition,
      user: UserDefinition,
      // Add models here
    }) as Database<any, Models>;
    await db.start()
    provide({
      name: 'database',
      description: '数据库服务',
      value: db,
      dispose: async (db) => {
        await db.stop()
      }
    })
  }
  // 加载插件
  for (const pluginName of config.plugins || []) {
    const dir = config.plugin_dirs?.find((dir: string) => fs.existsSync(path.join(dir, pluginName)));
    if (dir) await importPlugin(path.join(process.cwd(), dir, pluginName));
  }
  logger.info(`${children.length} plugins loaded`);
})
addCommand(new MessageCommand('zt').action(async (message) => {
  return `${(process.memoryUsage.rss() / 1024 / 1024).toFixed(2)}MB`;
}));



// 5. 启动
await start();
if (process.env.NODE_ENV === 'development') {
  watch((p) => p.reload(), true)
}
// 6. 优雅关闭
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  stop();
  process.exit(0);
});

// 7. 异常处理
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
  stop();
  process.exit(1);
});
