/**
 * Consolidated type augmentation for the agent package.
 * This ensures all init sub-modules can use typed inject/useContext
 * without `as any` casts.
 */

import type { AIService } from '../service.js';
import type { AgentOrchestrator } from '../orchestrator/index.js';

declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: AIService;
      agent: AgentOrchestrator;
    }
  }
}

export {};
