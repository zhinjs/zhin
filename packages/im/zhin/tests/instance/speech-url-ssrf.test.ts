import { afterEach, describe, expect, it, vi } from 'vitest';
import { addTransport, removeTransport } from '@zhin.js/logger';
import { fetchPublicMediaBytes, type PublicMediaFetchOptions } from '@zhin.js/agent/security';
import { prepareSpeechHost, SPEECH_AUDIO_MAX_BYTES } from '../../src/instance/speech-host-installer.js';

const lookup = vi.hoisted(() => vi.fn());
vi.mock('node:dns/promises', async (importOriginal) => ({ ...(await importOriginal<object>()), lookup }));

type BinaryResponse = { status: number; statusText: string; headers: Record<string, string>; body: Uint8Array };

/** Pinned-transport stand-in: answers by URL; anything else is a connection the test did not expect. */
function transportFor(responses: Record<string, BinaryResponse>) {
  const requestBytes = vi.fn(async (url: URL) => {
    const response = responses[url.href];
    if (!response) throw new Error('unexpected connection');
    return response;
  });
  return { transport: { request: vi.fn(), requestBytes }, requestBytes };
}

const OGG = Uint8Array.from([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]);

/** STT service (openai provider) answers every transcription request. */
function stubSttService(text = '你好世界') {
  const sttFetch = vi.fn(async () => new Response(JSON.stringify({ text }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', sttFetch);
  return sttFetch;
}

function captureLogs() {
  const lines: string[] = [];
  const transport = { write: (line: string) => { lines.push(line); } };
  addTransport(transport);
  cleanups.push(() => removeTransport(transport));
  return lines;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
  lookup.mockReset();
});

const STT = { stt: { provider: 'openai', apiKey: 'k', host: 'https://stt.example' }, tts: { enabled: false } };

describe('Speech Host voice downloads (#1250 第 45 批 speech-url-ssrf)', () => {
  it('transcribes a public https voice address through the checked fetcher', async () => {
    const sttFetch = stubSttService();
    const { transport, requestBytes } = transportFor({
      'https://cdn.example/voice.ogg': { status: 200, statusText: 'OK', headers: { 'content-type': 'audio/ogg' }, body: OGG },
    });
    const fetchAudio = vi.fn((url: string, options: PublicMediaFetchOptions) => fetchPublicMediaBytes(url, { ...options, transport }));
    const host = await prepareSpeechHost(STT, { fetchAudio });

    await expect(host!.transcribeUrl('https://cdn.example/voice.ogg')).resolves.toBe('你好世界');
    expect(fetchAudio).toHaveBeenCalledWith('https://cdn.example/voice.ogg', expect.objectContaining({ maxBytes: SPEECH_AUDIO_MAX_BYTES }));
    expect(requestBytes).toHaveBeenCalledTimes(1);
    // Only the STT service was reached with the platform fetch; the audio went through the pinned transport.
    expect(sttFetch).toHaveBeenCalledTimes(1);
    expect(String((sttFetch.mock.calls[0] as unknown[])[0])).toBe('https://stt.example/v1/audio/transcriptions');
  });

  it.each([
    ['plain http', 'http://cdn.example/voice.ogg', 'cdn.example'],
    ['loopback', 'https://127.0.0.1/voice.ogg', '127.0.0.1'],
    ['private 10.x', 'https://10.20.30.40/voice.ogg', '10.20.30.40'],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/iam', '169.254.169.254'],
    ['IPv6 loopback', 'https://[::1]/voice.ogg', '[::1]'],
  ])('refuses %s without a request and logs only the host', async (_label, url, hostName) => {
    const sttFetch = stubSttService();
    const { transport, requestBytes } = transportFor({});
    const logs = captureLogs();
    const host = await prepareSpeechHost(STT, { fetchAudio: (target, options) => fetchPublicMediaBytes(target, { ...options, transport }) });

    await expect(host!.transcribeUrl(url)).resolves.toEqual({ status: 'refused', code: 'speech_url_blocked' });
    expect(requestBytes).not.toHaveBeenCalled();
    expect(sttFetch).not.toHaveBeenCalled();
    const line = logs.find(entry => entry.includes('speech_url_blocked'));
    expect(line).toContain(hostName);
    expect(line).not.toContain(url);
    expect(line).not.toMatch(/voice\.ogg|meta-data/u);
  });

  it('refuses a name that resolves to a private address (default checked fetcher, no connection)', async () => {
    const sttFetch = stubSttService();
    lookup.mockResolvedValue([{ address: '192.168.3.4', family: 4 }]);
    const host = await prepareSpeechHost(STT);
    await expect(host!.transcribeUrl('https://voice.example/a.ogg?token=secret')).resolves.toEqual({ status: 'refused', code: 'speech_url_blocked' });
    expect(lookup).toHaveBeenCalledWith('voice.example', { all: true, verbatim: true });
    expect(sttFetch).not.toHaveBeenCalled();
  });

  it('refuses a redirect into the internal network', async () => {
    const sttFetch = stubSttService();
    const { transport, requestBytes } = transportFor({
      'https://cdn.example/voice.ogg': { status: 302, statusText: 'Found', headers: { location: 'https://10.0.0.1/admin' }, body: new Uint8Array() },
    });
    const host = await prepareSpeechHost(STT, { fetchAudio: (url, options) => fetchPublicMediaBytes(url, { ...options, transport }) });
    await expect(host!.transcribeUrl('https://cdn.example/voice.ogg')).resolves.toEqual({ status: 'refused', code: 'speech_url_blocked' });
    expect(requestBytes).toHaveBeenCalledTimes(1);
    expect(sttFetch).not.toHaveBeenCalled();
  });

  it('a download that fails for other reasons is not a refusal', async () => {
    stubSttService();
    const { transport } = transportFor({
      'https://cdn.example/voice.ogg': { status: 404, statusText: 'Not Found', headers: {}, body: new Uint8Array() },
    });
    const host = await prepareSpeechHost(STT, { fetchAudio: (url, options) => fetchPublicMediaBytes(url, { ...options, transport }) });
    await expect(host!.transcribeUrl('https://cdn.example/voice.ogg')).resolves.toBeNull();
  });

  it('voice_stt audio_url goes through the same checks', async () => {
    const sttFetch = stubSttService('工具转写');
    const { transport, requestBytes } = transportFor({
      'https://cdn.example/voice.ogg': { status: 200, statusText: 'OK', headers: { 'content-type': 'audio/ogg' }, body: OGG },
    });
    const host = await prepareSpeechHost(STT, { fetchAudio: (url, options) => fetchPublicMediaBytes(url, { ...options, transport }) });
    const tool = host!.tools.find(item => item.name === 'voice_stt')!;

    await expect(tool.execute({ audio_url: 'https://169.254.169.254/latest/meta-data/' }))
      .resolves.toEqual({ error: expect.stringContaining('speech_url_blocked') });
    await expect(tool.execute({ audio_url: 'http://cdn.example/voice.ogg' }))
      .resolves.toEqual({ error: expect.stringContaining('speech_url_blocked') });
    expect(requestBytes).not.toHaveBeenCalled();
    expect(sttFetch).not.toHaveBeenCalled();

    await expect(tool.execute({ audio_url: 'https://cdn.example/voice.ogg' })).resolves.toEqual({ text: '工具转写' });
    expect(requestBytes).toHaveBeenCalledTimes(1);
  });
});
