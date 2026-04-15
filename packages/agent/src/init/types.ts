/**
 * Consolidated type augmentation for the agent package.
 * This ensures all init sub-modules can use typed inject/useContext
 * without `as any` casts.
 */

import type { AIService } from '../service.js';

// Re-export the augmentation so it is applied when this file is imported
declare module '@zhin.js/core' {
  namespace Plugin {
    interface Contexts {
      ai: AIService;
    }
  }
}

export {};
