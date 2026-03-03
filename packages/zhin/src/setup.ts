/**
 * zhin.js 启动入口：加载配置 → 注册服务 → 初始化 AI → 连接 Bot → 加载插件 → 启动并注册信号处理
 */
import { usePlugin } from '@zhin.js/core';
import { loadConfig } from './setup/load-config.js';
import { registerCoreServices } from './setup/register-core-services.js';
import { applyConfigAndDatabase } from './setup/apply-config-and-database.js';
import { registerAI } from './setup/register-ai.js';
import { connectBots } from './setup/connect-bots.js';
import { loadPlugins } from './setup/load-plugins.js';
import { registerSignalHandlers } from './setup/signal-handlers.js';

const plugin = usePlugin();
const { configFeature, appConfig } = loadConfig();

registerCoreServices(plugin, appConfig, configFeature);
applyConfigAndDatabase(plugin, appConfig);
registerAI();
await connectBots(plugin, appConfig);
await loadPlugins(plugin, appConfig);
await registerSignalHandlers(plugin);
