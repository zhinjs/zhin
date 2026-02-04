// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

// 导出核心框架（包含 Tool Service 和 AI Trigger 工具函数）
export * from '@zhin.js/core'
// 重新导出 logger（作为独立的工具）
export { default as logger } from '@zhin.js/logger'

// 导出 AI 模块的 AI 特有功能（AIService、Agent、Session 等）
export { 
  AIService, 
  createAIService, 
  Agent, 
  createAgent, 
  SessionManager,
} from '@zhin.js/ai'

// ================================================================================================
// 模块声明 - 允许插件通过 declare module "zhin.js" 扩展类型
// ================================================================================================
import type { AIService as AIServiceType } from '@zhin.js/ai'
import type { ToolService as ToolServiceType } from '@zhin.js/core'

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      // AI 服务（由 @zhin.js/ai 插件提供）
      ai: AIServiceType;
      // 工具服务（由 @zhin.js/core 提供）
      tool: ToolServiceType;
    }
    interface Extensions {
      defineModel<K extends keyof Models>(name: K, definition: import('@zhin.js/core').Definition<Models[K]>): void;
    }
  }
  interface RegisteredAdapters {}
  interface Models {}
}
