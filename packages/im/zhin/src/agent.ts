/** zhin.js/agent — AI 编排与 Agent（需安装 @zhin.js/agent） */
export * from '@zhin.js/agent';
export * from './agent-orchestrator-impl.js';

import type { AIService as AIServiceType } from '@zhin.js/agent';

declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      ai: AIServiceType;
    }
  }
}
