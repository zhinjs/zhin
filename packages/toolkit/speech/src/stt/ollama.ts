import type { STTConfig } from '../types.js';

/**
 * Ollama 没有音频转写模型（whisper 不在 ollama 模型库中），
 * 把音频 base64 塞进 chat images 字段的契约不成立，调用必然失败。
 * 因此这里直接给出明确报错，而不是静默发出无效请求。
 */
export async function transcribeWithOllama(
  _audioData: Buffer,
  _sttConfig: STTConfig,
  _mimeType: string = 'audio/wav',
): Promise<string> {
  throw new Error(
    'Ollama STT 不可用：ollama 不支持音频转写（无 whisper 音频模型）。' +
      '请将 speech.stt.provider 配置为 "openai"（OpenAI 兼容的 whisper 接口）。',
  );
}
