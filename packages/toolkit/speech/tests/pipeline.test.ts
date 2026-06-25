import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSpeechPipeline } from '../src/pipeline.js';
import { createOpenAiTtsProvider } from '../src/tts/openai.js';
import { createAzureTtsProvider } from '../src/tts/azure.js';
import { createCustomTtsProvider } from '../src/tts/custom.js';

describe('createSpeechPipeline', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes STT to openai when provider is openai', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ text: '你好' }),
    } as Response);

    const pipeline = createSpeechPipeline({
      stt: { provider: 'openai', apiKey: 'sk-test', host: 'https://api.openai.com' },
    });

    const text = await pipeline.transcribe({
      data: Buffer.from('audio-bytes'),
      mimeType: 'audio/wav',
    });

    expect(text).toBe('你好');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('routes TTS to openai provider without edge exec', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } as Response);

    const pipeline = createSpeechPipeline({
      tts: { provider: 'openai', apiKey: 'sk-test', model: 'tts-1', voice: 'alloy' },
    });

    const result = await pipeline.synthesize({ text: 'hello' });
    expect(result.format).toBe('mp3');
    expect(result.data.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
  });
});

describe('OpenAI TTS provider', () => {
  it('falls back apiKey from stt config', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('mp3').buffer,
    } as Response));

    const provider = createOpenAiTtsProvider({
      stt: { apiKey: 'shared-key' },
      tts: { provider: 'openai' },
    });
    await provider.synthesize({ text: 'hi' });

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer shared-key' }),
      }),
    );

    vi.unstubAllGlobals();
  });
});

describe('Azure TTS provider', () => {
  it('posts SSML with subscription key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('mp3').buffer,
    } as Response));

    const provider = createAzureTtsProvider({
      region: 'eastasia',
      subscriptionKey: 'azure-key',
      voice: 'zh-CN-XiaoxiaoNeural',
    });
    await provider.synthesize({ text: '测试' });

    expect(fetch).toHaveBeenCalledWith(
      'https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Ocp-Apim-Subscription-Key': 'azure-key' }),
      }),
    );

    vi.unstubAllGlobals();
  });
});

describe('Custom TTS provider', () => {
  it('uses baseUrl and custom headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('mp3').buffer,
    } as Response));

    const provider = createCustomTtsProvider({
      tts: {
        provider: 'custom',
        baseUrl: 'https://my-tts.example/v1/audio/speech',
        apiKey: 'custom-key',
        headers: { 'X-Custom': 'value' },
      },
    });
    await provider.synthesize({ text: 'hello' });

    expect(fetch).toHaveBeenCalledWith(
      'https://my-tts.example/v1/audio/speech',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer custom-key',
          'X-Custom': 'value',
        }),
      }),
    );

    vi.unstubAllGlobals();
  });
});
