/**
 * zhin.js 启动入口：加载配置 → 注册服务 → 初始化 AI → 连接 Bot → 加载插件 → 启动并注册信号处理
 */
import { usePlugin, type PendingLoginTask } from '@zhin.js/core';
import { loadConfig } from './setup/load-config.js';
import { registerCoreServices } from './setup/register-core-services.js';
import { applyConfigAndDatabase } from './setup/apply-config-and-database.js';
import { registerAI } from './setup/register-ai.js';
import { connectBots } from './setup/connect-bots.js';
import { loadPlugins } from './setup/load-plugins.js';
import { registerSignalHandlers } from './setup/signal-handlers.js';
import { registerUnifiedInboxMessageListeners } from './setup/register-inbox.js';

const plugin = usePlugin();
const { configFeature, appConfig } = loadConfig();

registerCoreServices(plugin, appConfig, configFeature);
applyConfigAndDatabase(plugin, appConfig);
registerAI();

// 登录辅助：CLI 消费者（有 TTY 时从 stdin 读取并 submit，无 TTY 时仅靠 Web 控制台消费）
plugin.on('bot.login.pending', (task: PendingLoginTask) => {
  if (!process.stdin.isTTY) return;
  const loginAssist = plugin.inject('loginAssist' as any) as { submit: (id: string, value: string | Record<string, unknown>) => boolean } | undefined;
  if (!loginAssist) return;
  const msg = task.payload?.message ?? '';
  console.log(`[登录辅助] ${task.adapter}/${task.botId} ${task.type}: ${msg}`);
  if (task.payload?.image) console.log(`二维码: ${task.payload.image}`);
  if (task.payload?.url) console.log(`滑块: ${task.payload.url}`);
  process.stdin.once('data', (data: Buffer) => {
    const line = data.toString().trim();
    const value = task.type === 'qrcode' && !line ? { done: true } : line;
    loginAssist.submit(task.id, value);
  });
});

await connectBots(plugin, appConfig);
await loadPlugins(plugin, appConfig);
registerUnifiedInboxMessageListeners(plugin, appConfig);
await registerSignalHandlers(plugin);
