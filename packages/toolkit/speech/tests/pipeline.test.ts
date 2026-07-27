import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createSpeechPipeline } from '../src/pipeline.js';
import { extFromMimeType } from '../src/stt/openai.js';
import { resolveTtsProvider } from '../src/tts/index.js';
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

describe('Ollama STT provider', () => {
  it('明确报错而不是发出无效请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = createSpeechPipeline({
      stt: { provider: 'ollama', host: 'http://localhost:11434' },
    });

    await expect(
      pipeline.transcribe({ data: Buffer.from('audio-bytes'), mimeType: 'audio/wav' }),
    ).rejects.toThrow(/ollama 不支持音频转写/);
    // 不应发出任何请求
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe('OpenAI STT mime → 扩展名映射', () => {
  it('audio/mpeg 映射为 mp3，amr/ogg/silk 各归其位', () => {
    expect(extFromMimeType('audio/mpeg')).toBe('mp3');
    expect(extFromMimeType('audio/mp3')).toBe('mp3');
    expect(extFromMimeType('audio/wav')).toBe('wav');
    expect(extFromMimeType('audio/ogg')).toBe('ogg');
    expect(extFromMimeType('audio/amr')).toBe('amr');
    expect(extFromMimeType('audio/silk')).toBe('silk');
    expect(extFromMimeType('audio/webm; codecs=opus')).toBe('webm');
    expect(extFromMimeType('application/octet-stream')).toBe('wav');
  });

  it('转写时按 mimeType 生成正确文件名，且带超时 signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: '你好' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const pipeline = createSpeechPipeline({
      stt: { provider: 'openai', apiKey: 'sk-test', host: 'https://api.openai.com' },
    });
    await pipeline.transcribe({ data: Buffer.from('audio-bytes'), mimeType: 'audio/mpeg' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const formData = init.body as FormData;
    expect((formData.get('file') as File).name).toBe('audio.mp3');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    vi.unstubAllGlobals();
  });
});

describe('resolveTtsProvider', () => {
  it('未知 provider 抛错并列出合法值，不再静默回退 edge', () => {
    expect(() =>
      resolveTtsProvider({ tts: { provider: 'not-a-provider' as never } }),
    ).toThrow(/未知 TTS provider: not-a-provider。合法值: edge, openai, azure, custom/);
  });

  it('合法 provider 正常解析', () => {
    expect(resolveTtsProvider({ tts: { provider: 'edge' } }).id).toBe('edge');
    expect(resolveTtsProvider({ tts: {} }).id).toBe('edge');
  });
});

describe('TTS fetch 超时', () => {
  it('OpenAI TTS 请求带 AbortSignal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from('mp3').buffer,
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const provider = createOpenAiTtsProvider({ tts: { provider: 'openai', apiKey: 'k' } });
    await provider.synthesize({ text: 'hi' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);

    vi.unstubAllGlobals();
  });
});
