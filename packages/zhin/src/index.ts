// ================================================================================================
// zhin.js - 开箱即用的机器人框架
// ================================================================================================

// 导出核心框架
export * from '@zhin.js/core'
// 重新导出 logger（作为独立的工具）
export { default as logger } from '@zhin.js/logger'

// ================================================================================================
// 模块声明 - 允许插件通过 declare module "zhin.js" 扩展类型
// ================================================================================================
// 重新声明可扩展接口，使得 declare module "zhin.js" 可以正确合并类型
// 这些接口会与 @zhin.js/core 中的原始定义合并
declare module "zhin.js" {
  // 重新导出 Plugin 命名空间中的可扩展接口
  namespace Plugin {
    // 可扩展的 Context 注册表
    interface Contexts {}
    // 扩展方法
    interface Extensions {
      /**
       * 定义数据库模型
       * @param name 模型名称
       * @param definition 模型定义
       */
      defineModel<K extends keyof Models>(name: K, definition: import('@zhin.js/core').Definition<Models[K]>): void;
    }
  }
  // 可扩展的适配器注册表
  interface RegisteredAdapters {}
  // 可扩展的数据模型注册表
  interface Models {}
}
