import { initAgentModule } from '@zhin.js/agent';

/**
 * 初始化 AI 模块（须在 provide(DatabaseFeature) 之后调用，以便 defineModel 可用）
 */
export function registerAI(): void {
  initAgentModule();
}
