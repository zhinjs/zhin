/**
 * Shared mutable references between init sub-modules.
 *
 * These refs allow the split modules to coordinate without passing
 * the instances through function parameters everywhere.
 */
import type { AIService } from '../service.js';
import type { ZhinAgent } from '../zhin-agent/index.js';

export interface AIServiceRefs {
  aiService: AIService | null;
  zhinAgent: ZhinAgent | null;
}

export function createRefs(): AIServiceRefs {
  return {
    aiService: null,
    zhinAgent: null,
  };
}
