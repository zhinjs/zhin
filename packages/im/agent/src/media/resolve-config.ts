import { DEFAULT_MULTIMODAL_CONFIG, type MultimodalConfig } from './media-types.js';

export function resolveMultimodalConfig(): MultimodalConfig {
  return { ...DEFAULT_MULTIMODAL_CONFIG };
}
