
import { setLevel, LogLevel } from '@zhin.js/logger';
import {
  usePlugin, resolveEntry,
  Adapter,
  ConfigFeature, PermissionFeature,
  CommandFeature, ComponentFeature, CronFeature,
  SkillFeature, DatabaseFeature,
  createMessageDispatcher,
  ProcessAdapter,
  initAIModule,
} from '@zhin.js/core';
import { AppConfig } from './types.js';
import { DatabaseLogTransport } from './log-transport.js';
import * as path from 'path';

const plugin = usePlugin();
const {
  provide,
  start, stop,
  useContext,
  logger, children,
  import: importPlugin } = plugin;

// 1. 先加载配置，用户在 zhin.config 中决定启用哪些服务
//    自动发现配置文件：zhin.config.yml / .yaml / .json / .toml
import { ConfigLoader } from '@zhin.js/core';
const configFile = ConfigLoader.discover('zhin.config') || 'zhin.config.yml';
const configFeature = new ConfigFeature();
await configFeature.load(configFile, {
  log_level: LogLevel.INFO,
  bots: [],
  database: {
    dialect: "sqlite",
    filename: "./data/test.db"
  },
  plugin_dirs: ['node_modules', './src/plugins'],
  plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
  services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
});
const appConfig = configFeature.get<AppConfig>(configFile);
const enabledServices = new Set(appConfig.services || ['process', 'config', 'command', 'component', 'permission', 'cron']);

// 注册配置服务（必须）
provide(configFeature);

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
  provide(new CommandFeature());
}

if (enabledServices.has('component')) {
  provide(new ComponentFeature());
}

if (enabledServices.has('permission')) {
  provide(new PermissionFeature());
}

if (enabledServices.has('cron')) {
  provide(new CronFeature());
}

// 消息调度器（AI 驱动架构核心）
provide(createMessageDispatcher());

// Skill 注册表（AI 能力描述）
provide(new SkillFeature());

// 3. 配置生效：日志、数据库、插件加载
setLevel(appConfig.log_level || LogLevel.INFO);

if (appConfig.database) {
  provide(new DatabaseFeature(appConfig.database));
  const logTransport = new DatabaseLogTransport(plugin);
  // 直接访问 logger 实例的 transports 数组，或使用非递归方式
  // 检查是否已存在 DatabaseLogTransport（避免重复添加）
  if (!logger['transports'].some((t: any) => t instanceof DatabaseLogTransport)) {
    logger['transports'].push(logTransport);
  }
}

// AI 模块初始化（原 @zhin.js/ai，已合并至 core）
// 必须在 provide(DatabaseFeature) 之后，这样 defineModel 才可用
initAIModule();
const contexts=new Set(appConfig.bots?.map((bot) => bot.context) || []);
for(const context of contexts){
  useContext(context,async (adapter)=>{
    if(!(adapter instanceof Adapter)) throw new Error(`Adapter ${context} not found`);
    for(const config of appConfig.bots?.filter((bot) => bot.context === context) || []) {
      const bot=adapter.createBot(config);
      await bot.$connect();
      adapter.bots.set(bot.$id, bot);
      adapter.logger.debug(`bot ${bot.$id} of adapter ${adapter.name} connected`);
    }
  });
}

// 4. 加载插件定义（在调用 start() 之前导入插件，start 时统一挂载）
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

// 5. 启动核心上下文（确保扩展方法可用，比如 addCommand）
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

// 仅记录，不退出进程。避免 ICQQ ApiRejection 等第三方未捕获的 Promise 拒绝导致整机挂掉
const handleUnhandledRejection = (reason: unknown) => {
  if (reason instanceof Error) {
    logger.error('Unhandled rejection (进程继续运行):', reason.message);
    logger.debug(reason.stack);
  } else {
    const msg = typeof reason === 'object' && reason !== null && 'message' in reason
      ? (reason as { message?: string }).message ?? String(reason)
      : String(reason);
    logger.error('Unhandled rejection (进程继续运行):', msg);
  }
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
