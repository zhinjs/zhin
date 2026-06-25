import type { TTSConfig, TtsProvider, TtsSynthesizeInput, TtsSynthesizeResult } from '../types.js';

/** Azure Cognitive Services text-to-speech REST (output format: audio-16khz-128kbitrate-mono-mp3) */
export function createAzureTtsProvider(config: TTSConfig): TtsProvider {
  return {
    id: 'azure',
    async synthesize(input: TtsSynthesizeInput): Promise<TtsSynthesizeResult> {
      const region = config.region || 'eastasia';
      const subscriptionKey = config.subscriptionKey || '';
      const voice = input.voice || config.voice || 'zh-CN-XiaoxiaoNeural';
      const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

      const ssml = `<speak version='1.0' xml:lang='zh-CN'><voice name='${voice}'>${escapeXml(input.text)}</voice></speak>`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': subscriptionKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
      });

      if (!response.ok) {
        throw new Error(`Azure TTS failed: ${response.status} ${response.statusText}`);
      }

      const data = Buffer.from(await response.arrayBuffer());
      return { data, format: 'mp3' };
    },
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
