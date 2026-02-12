// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

// 导出核心框架（包含 Tool Service、AI 模块、AI Trigger 工具函数）
export * from '@zhin.js/core'
// 重新导出 logger（作为独立的工具）
export { default as logger } from '@zhin.js/logger'

// ================================================================================================
// 模块声明 - 允许插件通过 declare module "zhin.js" 扩展类型
// ================================================================================================
import type { AIService as AIServiceType } from '@zhin.js/core'
import type { ToolFeature as ToolFeatureType } from '@zhin.js/core'

declare module "zhin.js" {
  namespace Plugin {
    interface Contexts {
      // AI 服务（由 @zhin.js/core 内置 AI 模块提供）
      ai: AIServiceType;
      // 工具服务（由 @zhin.js/core 提供）
      tool: ToolFeatureType;
    }
    interface Extensions {
      defineModel<K extends keyof Models>(name: K, definition: import('@zhin.js/core').Definition<Models[K]>): void;
    }
  }
  interface RegisteredAdapters {}
  interface Models {}
}
