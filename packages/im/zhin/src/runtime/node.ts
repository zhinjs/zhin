import { usePlugin, type PendingLoginTask, type Plugin } from '@zhin.js/core';
import { applyConfigAndDatabase } from '../setup/apply-config-and-database.js';
import { connectBots } from '../setup/connect-bots.js';
import { loadConfig } from '../setup/load-config.js';
import { loadPlugins } from '../setup/load-plugins.js';
import { registerAI } from '../setup/register-ai.js';
import { registerCoreServices } from '../setup/register-core-services.js';
import { registerSignalHandlers } from '../setup/signal-handlers.js';
import { registerUnifiedInboxMessageListeners } from '../setup/register-inbox.js';
import { registerChatMessageStore } from '../setup/register-chat-message-store.js';
import { chdirToProjectRoot, resolveConfigPath } from './shared.js';
import type { BootstrapNodeResult, BootstrapOptions } from './types.js';

function registerStdinLoginAssist(plugin: Plugin): void {
  plugin.on('bot.login.pending', (task: PendingLoginTask) => {
    const g = globalThis as { process?: { stdin?: { isTTY?: boolean; once: (ev: string, fn: (d: Buffer) => void) => void } } };
    if (!g.process?.stdin?.isTTY) return;
    const loginAssist = plugin.inject('loginAssist' as keyof Plugin.Contexts) as {
      submit: (id: string, value: string | Record<string, unknown>) => boolean;
    } | undefined;
    if (!loginAssist) return;
    const msg = task.payload?.message ?? '';
    console.log(`[登录辅助] ${task.adapter}/${task.botId} ${task.type}: ${msg}`);
    if (task.payload?.image) console.log(`二维码: ${task.payload.image}`);
    if (task.payload?.url) console.log(`滑块: ${task.payload.url}`);
    g.process.stdin.once('data', (data: Buffer) => {
      const line = data.toString().trim();
      const value = task.type === 'qrcode' && !line ? { done: true } : line;
      loginAssist.submit(task.id, value);
    });
  });
}

/**
 * Node / Bun Host 启动（与 legacy setup.ts 同序）；`registerSignalHandlers` 内调用 `plugin.start()`。
 */
export async function bootstrapNode(options: BootstrapOptions = {}): Promise<BootstrapNodeResult> {
  const envRoot = process.env.ZHIN_PROJECT_ROOT?.trim();
  const root = options.projectRoot ?? envRoot;
  if (root) {
    chdirToProjectRoot(root);
  }

  const plugin = usePlugin();
  const { configFeature, appConfig } = loadConfig();
  const configPath = resolveConfigPath();

  registerCoreServices(plugin, appConfig, configFeature);
  applyConfigAndDatabase(plugin, appConfig);
  registerAI();
  registerStdinLoginAssist(plugin);

  await connectBots(plugin, appConfig);
  await loadPlugins(plugin, appConfig);
  registerUnifiedInboxMessageListeners(plugin, appConfig);
  registerChatMessageStore(plugin, appConfig);
  await registerSignalHandlers(plugin);

  return { plugin, configFeature, appConfig, configPath };
}
