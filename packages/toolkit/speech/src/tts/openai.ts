import type { SpeechConfig, TTSConfig, TtsProvider, TtsSynthesizeInput, TtsSynthesizeResult } from '../types.js';

function resolveOpenAiApiKey(config: SpeechConfig): string {
  return config.tts?.apiKey || config.stt?.apiKey || '';
}

export function createOpenAiTtsProvider(config: SpeechConfig): TtsProvider {
  const ttsConfig = config.tts || {};
  return {
    id: 'openai',
    async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
      const host = (ttsConfig.host || 'https://api.openai.com').replace(/\/$/, '');
      const model = ttsConfig.model || 'tts-1';
      const voice = input.voice || ttsConfig.voice || 'alloy';
      const apiKey = resolveOpenAiApiKey(config);
      const format = input.format === 'wav' ? 'wav' : 'mp3';

      const body: Record<string, unknown> = {
        model,
        input: input.text,
        voice,
        response_format: format,
      };
      if (input.speed != null) body.speed = input.speed;
      else if (ttsConfig.speed != null) body.speed = ttsConfig.speed;

      const response = await fetch(`${host}/v1/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`OpenAI TTS failed: ${response.status} ${response.statusText}`);
      }

      const data = Buffer.from(await response.arrayBuffer());
      return { data, format };
    },
  };
}
