import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import type { STTConfig } from '../types.js';

export async function transcribeWithOpenAI(
  audioData: Buffer,
  sttConfig: STTConfig,
  mimeType: string = 'audio/wav',
): Promise<string> {
  const host = sttConfig.host || 'https://api.openai.com';
  const model = sttConfig.model || 'whisper-1';
  const apiKey = sttConfig.apiKey || '';

  const tmpFile = join(tmpdir(), `zhin-stt-${randomBytes(8).toString('hex')}.wav`);
  await writeFile(tmpFile, audioData);

  try {
    const ext = mimeType.includes('mp3') ? 'mp3' : 'wav';
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioData)], { type: mimeType });
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', model);
    formData.append('language', 'zh');

    const response = await fetch(`${host}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { text?: string };
    return data.text?.trim() || '';
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
