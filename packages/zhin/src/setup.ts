
import { setLevel, LogLevel } from '@zhin.js/logger';
import {
  usePlugin, resolveEntry,
  ConfigService, PermissionService,
  createCommandService, createComponentService, createCronService,
  defineDatabaseService,
  ProcessAdapter,
} from '@zhin.js/core';
import { AppConfig } from './types.js';
import { DatabaseLogTransport } from './log-transport.js';
import * as path from 'path';

const plugin = usePlugin();
const {
  provide,
  start, stop,
  logger, children,
  import: importPlugin } = plugin;

// 1. 先加载配置，用户在 zhin.config 中决定启用哪些服务
const configService = new ConfigService();
await configService.load('zhin.config.yml', {
  log_level: LogLevel.INFO,
  database: {
    dialect: "sqlite",
    filename: "./data/test.db"
  },
  plugin_dirs: [path.relative(process.cwd(), import.meta.dirname), 'node_modules/@zhin.js', './plugins',],
  plugins: [],
  services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
});
const appConfig = configService.get<AppConfig>('zhin.config.yml');
const enabledServices = new Set(appConfig.services || ['process', 'config', 'command', 'component', 'permission', 'cron']);

// 注册配置服务（必须）
provide({
  name: 'config',
  description: '配置服务',
  value: configService,
});

// 2. 可选服务按配置注册
if (enabledServices.has('process')) {
  provide({
    name: 'process',
    description: '命令行适配器',
    mounted: async (plugin) => {
      const adapter = new ProcessAdapter(plugin);
      await adapter.start();
      return adapter;
    },
    dispose: async (adapter) => {
      await adapter.stop();
    }
  });
}

if (enabledServices.has('command')) {
  provide(createCommandService());
}

if (enabledServices.has('component')) {
  provide(createComponentService());
}

if (enabledServices.has('permission')) {
  provide({
    name: 'permission',
    description: '权限管理',
    value: new PermissionService(),
  });
}

if (enabledServices.has('cron')) {
  provide(createCronService());
}

// 3. 配置生效：日志、数据库、插件加载
setLevel(appConfig.log_level || LogLevel.INFO);

if (appConfig.database) {
  provide(defineDatabaseService(appConfig.database));
  const logTransport = new DatabaseLogTransport(plugin);
  // 直接访问 logger 实例的 transports 数组，或使用非递归方式
  // 检查是否已存在 DatabaseLogTransport（避免重复添加）
  if (!logger['transports'].some((t: any) => t instanceof DatabaseLogTransport)) {
    logger['transports'].push(logTransport);
  }
}

// 4. 启动核心上下文（确保扩展方法可用，比如 addCommand）
await start();

// 5. 加载插件（父插件已启动，会自动 start 子插件）
// 先去重插件列表，避免重复加载
const pluginNames = new Set(appConfig.plugins || []);
logger.debug(`Plugin list: ${Array.from(pluginNames).join(', ')}`);
for (const pluginName of pluginNames) {
  const dir = appConfig.plugin_dirs?.find((dir: string) => resolveEntry(path.join(dir, pluginName)));
  if (dir) {
    const pluginPath = path.join(process.cwd(), dir, pluginName);
    logger.debug(`Importing plugin: ${pluginName} from ${pluginPath}`);
    await importPlugin(pluginPath);
  }
}
logger.debug(`${children.length} plugins loaded`);

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
