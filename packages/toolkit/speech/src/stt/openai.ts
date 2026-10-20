import type { STTConfig } from '../types.js';

/** STT 请求超时（转写大音频可能较慢） */
const STT_FETCH_TIMEOUT_MS = 60_000;

/** mimeType → 文件扩展名映射（OpenAI whisper 按扩展名识别格式） */
const MIME_TO_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/amr': 'amr',
  'audio/silk': 'silk',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
};

export function extFromMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] ?? 'wav';
}

export async function transcribeWithOpenAI(
  audioData: Buffer,
  sttConfig: STTConfig,
  mimeType: string = 'audio/wav',
): Promise<string> {
  const host = sttConfig.host || 'https://api.openai.com';
  const model = sttConfig.model || 'whisper-1';
  const apiKey = sttConfig.apiKey || '';

  const ext = extFromMimeType(mimeType);
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioData)], { type: mimeType });
  formData.append('file', blob, `audio.${ext}`);
  formData.append('model', model);
  formData.append('language', 'zh');

  const response = await fetch(`${host}/v1/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(STT_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenAI STT failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { text?: string };
  return data.text?.trim() || '';
}
