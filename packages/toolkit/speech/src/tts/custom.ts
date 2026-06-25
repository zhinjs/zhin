import type { SpeechConfig, TTSConfig, TtsProvider, TtsSynthesizeInput, TtsSynthesizeResult } from '../types.js';

function resolveOpenAiApiKey(config: SpeechConfig): string {
  return config.tts?.apiKey || config.stt?.apiKey || '';
}

export function createCustomTtsProvider(config: SpeechConfig): TtsProvider {
  const ttsConfig = config.tts || {};
  return {
    id: 'custom',
    async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
      const baseUrl = (ttsConfig.baseUrl || '').replace(/\/$/, '');
      if (!baseUrl) {
        throw new Error('custom TTS requires speech.tts.baseUrl');
      }
      const model = ttsConfig.model || 'tts-1';
      const voice = input.voice || ttsConfig.voice || 'default';
      const apiKey = resolveOpenAiApiKey(config);
      const format = input.format === 'wav' ? 'wav' : 'mp3';

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(ttsConfig.headers || {}),
      };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const body: Record<string, unknown> = {
        model,
        input: input.text,
        voice,
        response_format: format,
      };
      if (input.speed != null) body.speed = input.speed;
      else if (ttsConfig.speed != null) body.speed = ttsConfig.speed;

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Custom TTS failed: ${response.status} ${response.statusText}`);
      }

      const data = Buffer.from(await response.arrayBuffer());
      return { data, format };
    },
  };
}
