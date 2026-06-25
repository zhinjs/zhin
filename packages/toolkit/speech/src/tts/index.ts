import type { SpeechConfig, TtsProvider, TtsProviderId } from '../types.js';
import { createAzureTtsProvider } from './azure.js';
import { createCustomTtsProvider } from './custom.js';
import { createEdgeTtsProvider } from './edge.js';
import { createOpenAiTtsProvider } from './openai.js';

export function resolveTtsProvider(config: SpeechConfig, override?: TtsProviderId): TtsProvider {
  const ttsConfig = config.tts || {};
  const id = override || ttsConfig.provider || 'edge';

  switch (id) {
    case 'openai':
      return createOpenAiTtsProvider(config);
    case 'azure':
      return createAzureTtsProvider(ttsConfig);
    case 'custom':
      return createCustomTtsProvider(config);
    case 'edge':
    default:
      return createEdgeTtsProvider(ttsConfig);
  }
}
