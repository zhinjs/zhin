// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

export * from './re-exports/core.js';
export * from './re-exports/agent.js';
export * from './re-exports/orchestrator.js';
export { default as logger } from '@zhin.js/logger';

// ================================================================================================
// 模块声明 - 允许插件通过 declare module "zhin.js" 扩展类型
// ================================================================================================
import type { AIService as AIServiceType } from '@zhin.js/agent';
import type { ToolFeature as ToolFeatureType } from '@zhin.js/core';

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      ai: AIServiceType;
      tool: ToolFeatureType;
    }
    interface Extensions {
      defineModel<K extends keyof Models>(name: K, definition: import('@zhin.js/core').Definition<Models[K]>): void;
    }
  }
  interface RegisteredAdapters {}
  interface Models {}
}
