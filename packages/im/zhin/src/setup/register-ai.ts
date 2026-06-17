import { getPlugin } from '@zhin.js/core';

/**
 * 初始化 AI 模块（须在 provide(DatabaseFeature) 之后调用，以便 defineModel 可用）
 * 未安装 @zhin.js/agent 时静默跳过。
 */
export async function registerAI(): Promise<void> {
  try {
    const { initAgentModule } = await import('@zhin.js/agent');
    initAgentModule();
  } catch (error) {
    const plugin = getPlugin();
    plugin.logger?.warn?.(
      '@zhin.js/agent 未安装，已跳过 AI 模块。需要 AI 请执行: pnpm add @zhin.js/agent',
    );
    if (process.env.NODE_ENV === 'test') {
      throw error;
    }
  }
}
