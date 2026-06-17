// ================================================================================================
// zhin.js 4.x — IM 核心（<10MB production 闭包目标）
// AI/Agent：请安装 @zhin.js/agent 或 import from 'zhin.js/agent'
// ================================================================================================

export * from '@zhin.js/core';

export { default as logger, formatCompact, formatCompactLog, formatCompactUsage, truncatePreview } from '@zhin.js/logger';

declare module 'zhin.js' {
  namespace Plugin {
    interface Extensions {
      defineModel<K extends keyof Models>(name: K, definition: import('@zhin.js/core').Definition<Models[K]>): void;
    }
  }
  interface RegisteredAdapters {}
  interface Models {
    unified_inbox_message?: object;
    unified_inbox_request?: object;
    unified_inbox_notice?: object;
  }
}
