import type { AIService } from '../service.js';
import type { ZhinAgent } from '../zhin-agent/index.js';

export interface AIServiceRefs {
  aiService: AIService | null;
  zhinAgent: ZhinAgent | null;
}
