import type { SpeechConfig, TtsProvider, TtsProviderId } from '../types.js';
import { createAzureTtsProvider } from './azure.js';
import { createCustomTtsProvider } from './custom.js';
import { createEdgeTtsProvider } from './edge.js';
import { createOpenAiTtsProvider } from './openai.js';

const VALID_TTS_PROVIDERS: TtsProviderId[] = ['edge', 'openai', 'azure', 'custom'];

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
      return createEdgeTtsProvider(ttsConfig);
    default:
      throw new Error(
        `未知 TTS provider: ${String(id)}。合法值: ${VALID_TTS_PROVIDERS.join(', ')}`,
      );
  }
}
