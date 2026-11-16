import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkExecutable,
  checkSpeechDependencies,
  formatSpeechReadyLine,
  prepareSpeechHost,
} from '../../src/instance/speech-host-installer.js';
import { splitToolResultMedia } from '../../../agent/src/media/media-tool-bridge.js';

const posix = process.platform !== 'win32';
let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'zhin-speech-deps-')); });
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

function executable(name: string, mode = 0o755): string {
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, mode);
  return file;
}

describe('speech dependency check (#1250 batch 29 speech-ready-without-tts-binary)', () => {
  it.runIf(posix)('resolves a bare command on PATH and an absolute path without running it', async () => {
    const file = executable('edge-tts');
    expect(await checkExecutable('edge-tts', { env: { PATH: dir } })).toBe('ok');
    expect(await checkExecutable(file, { env: { PATH: '' } })).toBe('ok');
    expect(await checkExecutable('edge-tts', { env: { PATH: join(dir, 'missing') } })).toBe('not-found');
    expect(await checkExecutable(join(dir, 'missing', 'edge-tts'))).toBe('not-found');
    mkdirSync(join(dir, 'sub'));
    expect(await checkExecutable(join(dir, 'sub'))).toBe('not-found');
  });

  it.runIf(posix && process.getuid?.() !== 0)('reports a file without the execute bit as not executable', async () => {
    const file = executable('edge-tts', 0o644);
    expect(await checkExecutable(file)).toBe('not-executable');
    expect(await checkExecutable('edge-tts', { env: { PATH: dir } })).toBe('not-executable');
  });

  it('honours PATHEXT on Windows', async () => {
    writeFileSync(join(dir, 'edge-tts.EXE'), '');
    expect(await checkExecutable('edge-tts', { platform: 'win32', env: { Path: dir, PATHEXT: '.EXE' } })).toBe('ok');
    expect(await checkExecutable('edge-tts', { platform: 'win32', env: { Path: dir, PATHEXT: '.CMD' } })).toBe('not-found');
  });

  it('only checks the edge TTS provider, and explains the fix (absolute path for managed services)', async () => {
    expect(await checkSpeechDependencies({ tts: { provider: 'openai' } })).toEqual([]);
    expect(await checkSpeechDependencies({ tts: { enabled: false } })).toEqual([]);
    expect(await checkSpeechDependencies({ stt: { provider: 'openai' }, tts: { provider: 'azure' } })).toEqual([]);
    const [issue] = await checkSpeechDependencies({ tts: {} }, { env: { PATH: join(dir, 'missing') }, now: () => 42 });
    expect(issue).toMatchObject({ feature: 'tts', provider: 'edge', configPath: 'speech.tts.edgeTtsCommand', command: 'edge-tts', reason: 'not-found', at: 42 });
    expect(issue!.message).toContain('未找到 edge-tts');
    expect(issue!.message).toContain('绝对路径');
    expect(issue!.message).toContain('~/.local/bin');
  });

  it('gives up after the timeout and reports it without blocking the tool', async () => {
    // A file system that never answers (e.g. a hung network mount on PATH).
    const never = () => new Promise<never>(() => {});
    const issues = await checkSpeechDependencies({ tts: {} }, { timeoutMs: 5, probe: never });
    expect(issues).toEqual([expect.objectContaining({ reason: 'timeout', command: 'edge-tts' })]);
    expect(issues[0]!.message).toContain('超时');
    vi.stubGlobal('fetch', vi.fn());
    const host = await prepareSpeechHost({ stt: { enabled: false }, tts: {} }, { timeoutMs: 5, probe: never });
    // Unknown is not unavailable: the tool still runs and reports what really happens.
    expect(host!.ttsAvailable).toBe(true);
    expect(formatSpeechReadyLine(host!)).toMatch(/^ready \| /u);
  });
});

describe('Speech Host with a missing edge-tts', () => {
  it('is not reported as ready, keeps voice_tts and returns the real reason to the model', async () => {
    const host = await prepareSpeechHost({ stt: { enabled: false }, tts: { provider: 'edge', edgeTtsCommand: join(dir, 'edge-tts') } });
    expect(host!.ttsAvailable).toBe(false);
    expect(host!.dependencyIssues()).toEqual([expect.objectContaining({ reason: 'not-found', configPath: 'speech.tts.edgeTtsCommand' })]);
    const line = formatSpeechReadyLine(host!);
    expect(line).not.toMatch(/^ready/u);
    expect(line).toMatch(/^degraded \| stt: ollama \| tts: edge \(unavailable: not-found /u);
    const tool = host!.tools.find(item => item.name === 'voice_tts')!;
    const result = await tool.execute({ text: '你好' }) as { error: string };
    expect(result.error).toContain('语音合成不可用');
    expect(result.error).toContain('未找到 edge-tts');
    expect(result.error).toContain('speech.tts.edgeTtsCommand');
  });

  it.runIf(posix)('picks up an edge-tts installed after startup without a restart', async () => {
    const command = join(dir, 'edge-tts');
    const host = await prepareSpeechHost({ stt: { enabled: false }, tts: { provider: 'edge', edgeTtsCommand: command } });
    expect(host!.ttsAvailable).toBe(false);
    // Installed now: a stub that writes an mp3 header where edge-tts is told to.
    writeFileSync(command, '#!/bin/sh\nwhile [ "$1" != "--write-media" ]; do shift; done\nprintf "ID3" > "$2"\n');
    chmodSync(command, 0o755);
    const tool = host!.tools.find(item => item.name === 'voice_tts')!;
    const result = await tool.execute({ text: '你好' });
    expect(result).toMatchObject({ format: 'mp3', size: 3 });
    expect(host!.ttsAvailable).toBe(true);
    expect(host!.dependencyIssues()).toEqual([]);
    expect(formatSpeechReadyLine(host!)).toMatch(/^ready \| /u);
  });

  it('does not block another provider chosen for one call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer }));
    const host = await prepareSpeechHost({ stt: { enabled: false }, tts: { provider: 'edge', edgeTtsCommand: join(dir, 'edge-tts'), apiKey: 'k' } });
    const tool = host!.tools.find(item => item.name === 'voice_tts')!;
    const result = await tool.execute({ text: '你好', provider: 'openai' });
    // The host keeps the bytes for the outbound chain; the model only gets metadata.
    const split = splitToolResultMedia('voice_tts', result);
    expect(JSON.stringify(split.output)).not.toContain('AQID');
    expect(split.output).toMatchObject({ format: 'mp3', size: 3, sent: true });
    expect(split.media).toEqual([{ type: 'audio', url: 'data:audio/mpeg;base64,AQID', base64: 'AQID' }]);
  });
});
