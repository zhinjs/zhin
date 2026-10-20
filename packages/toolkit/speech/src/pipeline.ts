import { transcribeWithOllama } from './stt/ollama.js';
import { transcribeWithOpenAI } from './stt/openai.js';
import { resolveTtsProvider } from './tts/index.js';
import type {
  SpeechConfig,
  SpeechLogger,
  SpeechPipeline,
  TranscribeInput,
  TtsSynthesizeInput,
} from './types.js';

const DEFAULT_SPEECH_CONFIG: SpeechConfig = {
  stt: {
    enabled: true,
    provider: 'ollama',
    model: 'whisper',
    host: 'http://localhost:11434',
  },
  tts: {
    enabled: true,
    provider: 'edge',
    voice: 'zh-CN-XiaoxiaoNeural',
    rate: '+0%',
    pitch: '+0Hz',
    edgeTtsCommand: 'edge-tts',
  },
};

function mergeSpeechConfig(config?: SpeechConfig): SpeechConfig {
  return {
    stt: { ...DEFAULT_SPEECH_CONFIG.stt, ...config?.stt },
    tts: { ...DEFAULT_SPEECH_CONFIG.tts, ...config?.tts },
  };
}

export function createSpeechPipeline(
  config?: SpeechConfig,
  _logger?: SpeechLogger,
): SpeechPipeline {
  const merged = mergeSpeechConfig(config);
  const sttConfig = merged.stt || {};
  const defaultTts = resolveTtsProvider(merged);

  return {
    async transcribe(input: TranscribeInput): Promise<string> {
      if (sttConfig.enabled === false) {
        throw new Error('STT is disabled in speech config');
      }
      const provider = sttConfig.provider || 'ollama';
      const mimeType = input.mimeType || 'audio/wav';
      if (provider === 'openai') {
        return transcribeWithOpenAI(input.data, sttConfig, mimeType);
      }
      return transcribeWithOllama(input.data, sttConfig, mimeType);
    },

    async synthesize(input: TtsSynthesizeInput) {
      if (merged.tts?.enabled === false) {
        throw new Error('TTS is disabled in speech config');
      }
      const provider = input.provider
        ? resolveTtsProvider(merged, input.provider)
        : defaultTts;
      return provider.synthesize(input);
    },
  };
}
