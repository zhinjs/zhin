import type { STTConfig } from '../types.js';

export async function transcribeWithOllama(
  audioData: Buffer,
  sttConfig: STTConfig,
  _mimeType: string = 'audio/wav',
): Promise<string> {
  const host = sttConfig.host || 'http://localhost:11434';
  const model = sttConfig.model || 'whisper';
  const base64Audio = audioData.toString('base64');

  const response = await fetch(`${host}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{
        role: 'user',
        content: '请将这段音频转写为文字，只输出转写的文字内容，不要加任何说明。',
        images: [base64Audio],
      }],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama STT failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  return data.message?.content?.trim() || '';
}
