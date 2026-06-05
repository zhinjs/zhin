import { getPlugin } from '@zhin.js/core';
import type { AIConfig } from '@zhin.js/ai';
import { DEFAULT_MULTIMODAL_CONFIG, type MultimodalConfig } from './media-types.js';

export function resolveMultimodalConfig(): MultimodalConfig {
  try {
    const plugin = getPlugin();
    const configService = plugin.root?.inject?.('config') as
      | { getPrimary?: () => { ai?: AIConfig } }
      | undefined;
    const mm = configService?.getPrimary?.()?.ai?.multimodal;
    if (!mm) return { ...DEFAULT_MULTIMODAL_CONFIG };
    return {
      enabled: mm.enabled !== false,
      maxFileBytes: mm.maxFileBytes ?? DEFAULT_MULTIMODAL_CONFIG.maxFileBytes,
      inboundDir: mm.inboundDir ?? DEFAULT_MULTIMODAL_CONFIG.inboundDir,
      outboundDir: mm.outboundDir ?? DEFAULT_MULTIMODAL_CONFIG.outboundDir,
      image: { ...DEFAULT_MULTIMODAL_CONFIG.image, ...mm.image },
      audio: {
        strategy: mm.audio?.strategy ?? DEFAULT_MULTIMODAL_CONFIG.audio.strategy,
      },
      video: {
        strategy: mm.video?.strategy ?? DEFAULT_MULTIMODAL_CONFIG.video.strategy,
        maxFrames: mm.video?.maxFrames ?? DEFAULT_MULTIMODAL_CONFIG.video.maxFrames,
      },
      outbound: {
        splitMessages: mm.outbound?.splitMessages ?? DEFAULT_MULTIMODAL_CONFIG.outbound.splitMessages,
      },
    };
  } catch {
    return { ...DEFAULT_MULTIMODAL_CONFIG };
  }
}
