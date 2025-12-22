
import { setLevel, LogLevel } from '@zhin.js/logger';
import {
  usePlugin, Models, SystemLogDefinition, resolveEntry,
  UserDefinition, ConfigService, PermissionService,
  CommandService, ComponentService, CronService, ProcessAdapter, Registry, Database
} from '@zhin.js/core';
import { AppConfig } from './types.js';
import { DatabaseLogTransport } from './log-transport.js';
import * as path from 'path';

const {
  useContext, provide,
  start, stop,
  logger, children,
  import: importPlugin } = usePlugin();
// 1. 加载服务插件
provide({
  name: 'process',
  description: '命令行适配器',
  mounted: async (plugin) => {
    const adapter = new ProcessAdapter(plugin)
    await adapter.start()
    return adapter
  },
  dispose: async (adapter) => {
    await adapter.stop()
  }
})
// 注册配置服务
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
// 注册指令服务
provide({
  name: 'command',
  description: '命令服务',
  value: new CommandService()
});
// 注册组件服务
provide({
  name: 'component',
  description: '组件服务',
  mounted: (plugin) => new ComponentService(plugin)
});
// 注册权限服务
provide({
  name: 'permission',
  description: '权限管理',
  value: new PermissionService(),
});
// 注册定时任务服务
provide({
  name: 'cron',
  description: '定时任务服务',
  value: new CronService(),
  dispose: async (cronService) => {
    await cronService.stopAll()
  }
});

useContext('config', async (configService) => {
  const plugin = usePlugin();
  const config = configService.get<AppConfig>('zhin.config.yml');
  // 4. 设置日志级别
  setLevel(config.log_level || LogLevel.INFO);
  if (config.database) {
    const { dialect, ...rest } = config.database
    const db = Registry.create<Models, typeof dialect>(dialect, rest, {
      SystemLog: SystemLogDefinition,
      User: UserDefinition,
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
    const logTransport = new DatabaseLogTransport(plugin)
    logger.addTransport(logTransport)
  }
  // 加载插件
  for (const pluginName of config.plugins || []) {
    const dir = config.plugin_dirs?.find((dir: string) => resolveEntry(path.join(dir, pluginName)));
    if (dir) await importPlugin(path.join(process.cwd(), dir, pluginName));
  }
  logger.debug(`${children.length} plugins loaded`);
})


// 5. 启动
await start();

// 6. 优雅关闭（使用 once 防止重复注册）
const handleSIGTERM = () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  stop();
  process.exit(0);
};

const handleSIGINT = () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  stop();
  process.exit(0);
};

// 7. 异常处理
const handleUncaughtException = (error: Error) => {
  logger.error('Uncaught exception:', error);
  stop();
  process.exit(1);
};

const handleUnhandledRejection = (reason: unknown) => {
  logger.error('Unhandled rejection:', reason);
  stop();
  process.exit(1);
};

// 移除可能存在的旧监听器（防止热重载时累积）
process.removeListener('SIGTERM', handleSIGTERM);
process.removeListener('SIGINT', handleSIGINT);
process.removeListener('uncaughtException', handleUncaughtException);
process.removeListener('unhandledRejection', handleUnhandledRejection);

// 注册新监听器
process.once('SIGTERM', handleSIGTERM);
process.once('SIGINT', handleSIGINT);
process.on('uncaughtException', handleUncaughtException);
process.on('unhandledRejection', handleUnhandledRejection);
