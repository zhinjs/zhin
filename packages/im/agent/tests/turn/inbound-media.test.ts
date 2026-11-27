import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserMessage } from '@zhin.js/ai';
import {
  applyInboundMediaInjection,
  resolveTurnMediaInjection,
} from '../../src/turn/inbound-media.js';
import { MediaPerceptionFailedError, type MediaPerceptionPort } from '../../src/media/perception.js';
import type { NetworkTransport } from '../../src/security/turn-network-client.js';

let root: string;

/** Bytes the pinned media transport serves, chosen by file extension (no real DNS or sockets). */
function bytesFor(url: string): Buffer {
  return url.endsWith('.mp4')
    ? Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
    : url.endsWith('.zip')
      ? Buffer.from([0x50, 0x4b, 0x03, 0x04])
      : url.endsWith('.jpg')
        ? Buffer.from([0xff, 0xd8, 0xff, 0xe0])
        : Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}
const mediaTransport: NetworkTransport = {
  request: async () => { throw new Error('text request not expected'); },
  requestBytes: async (url: URL) => ({ status: 200, statusText: 'OK', headers: {}, body: bytesFor(url.href) }),
};
/** Every call downloads URLs through the injected pinned transport. */
const resolveMedia: typeof resolveTurnMediaInjection = (media, options = {}) =>
  resolveTurnMediaInjection(media, { mediaTransport, ...options });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-media-'));
  // Inbound media URLs never use the global fetch (#1250 第 46 批: pinned download only).
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('global fetch must not be used for inbound media'); }));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('resolveTurnMediaInjection', () => {
  it('无媒体段 → 空注入', async () => {
    const injection = await resolveMedia([]);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual([]);
    expect(injection.outcomes).toEqual([]);
  });

  it('image：URL / base64 均先物化并校验真实内容', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const injection = await resolveMedia([
      { kind: 'image', source: { kind: 'url', value: 'https://cdn.example/a.jpg' }, mimeType: 'image/jpeg' },
      { kind: 'image', source: { kind: 'base64', value: png }, mimeType: 'application/pdf' },
    ], { signal: new AbortController().signal, providerInput: ['text', 'image'] });
    expect(injection.blocks.map((block) => block.data.media)).toEqual([
      { kind: 'base64', value: '/9j/4A==', mime_type: 'image/jpeg' },
      { kind: 'base64', value: png, mime_type: 'image/png' },
    ]);
    expect(injection.textAppends).toEqual([]);
    expect(injection.outcomes).toEqual([
      { kind: 'image', status: 'accepted', code: 'validated_provider_input' },
      { kind: 'image', status: 'accepted', code: 'validated_provider_input' },
    ]);
  });

  it('image：端点声明的入站目录内的 path 物化为 base64 块', async () => {
    const file = path.join(root, 'pic.png');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(file, png);
    const injection = await resolveMedia([
      { kind: 'image', source: { kind: 'path', value: file } },
    ], { signal: new AbortController().signal, providerInput: ['text', 'image'], inboundMediaRoots: [root] });
    expect(injection.blocks).toHaveLength(1);
    const block = injection.blocks[0]!;
    expect(block.type).toBe('image');
    expect(block.data.media.kind).toBe('base64');
    expect(block.data.media.mime_type).toBe('image/png');
    expect(Buffer.from(block.data.media.value, 'base64')).toEqual(png);
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
  });

  it('image：声明目录内但读盘失败 → 明确 rejected 终态', async () => {
    const file = path.join(root, 'broken.png');
    fs.writeFileSync(file, '%PDF-1.7\n');
    const injection = await resolveMedia([
      { kind: 'image', source: { kind: 'path', value: file } },
    ], { inboundMediaRoots: [root] });
    expect(injection.blocks).toEqual([]);
    // #1250 inbound-media-reject-reason-opaque: the bytes are a PDF, not the declared image.
    expect(injection.textAppends).toEqual(['[Media rejected:mime_mismatch: image]']);
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'rejected', code: 'mime_mismatch' }]);
  });

  describe('拒绝原因码与日志（#1250 inbound-media-reject-reason-opaque）', () => {
    async function rejected(media: Parameters<typeof resolveTurnMediaInjection>[0], transport: NetworkTransport = mediaTransport) {
      const { getLogger } = await import('@zhin.js/logger');
      const warn = vi.spyOn(getLogger('ZhinAgent'), 'warn').mockImplementation(() => undefined);
      try {
        const injection = await resolveTurnMediaInjection(media, { mediaTransport: transport, scene: 'qq/group/42', messageId: 'm-9' });
        return { injection, lines: warn.mock.calls.map(call => String(call[0])).filter(line => line.includes('inbound_media_rejected')) };
      } finally { warn.mockRestore(); }
    }
    const url = (value: string) => [{ kind: 'image' as const, source: { kind: 'url' as const, value } }];

    it.each([
      ['http://cdn.example/a.png?token=SECRET', 'scheme_unsupported', 'http', 'cdn.example'],
      ['ftp://cdn.example/a.png', 'scheme_unsupported', 'ftp', 'cdn.example'],
      ['https://127.0.0.1/a.png?sig=SECRET', 'host_not_allowed', 'https', '127.0.0.1'],
      ['https://cdn.example:8443/a.png', 'host_not_allowed', 'https', 'cdn.example'],
    ])('%s → %s', async (value, code, scheme, host) => {
      const { injection, lines } = await rejected(url(value));
      expect(injection.outcomes).toEqual([{ kind: 'image', status: 'rejected', code }]);
      expect(injection.textAppends).toEqual([`[Media rejected:${code}: image]`]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(`reason: ${code}`);
      expect(lines[0]).toContain('scene: qq/group/42');
      expect(lines[0]).toContain('message: m-9');
      expect(lines[0]).toContain(`scheme: ${scheme}`);
      expect(lines[0]).toContain(`host: ${host}`);
      expect(lines[0]).not.toMatch(/SECRET|a\.png/u);
    });

    it('download failures name the reason: HTTP status, oversized body, wrong type, transport error', async () => {
      const transport = (response: () => Promise<{ status: number; body: Buffer }>): NetworkTransport => ({
        request: async () => { throw new Error('unexpected'); },
        requestBytes: async () => ({ statusText: '', headers: {}, ...(await response()) }),
      });
      const notFound = await rejected(url('https://cdn.example/a.png'), transport(async () => ({ status: 404, body: Buffer.alloc(0) })));
      expect(notFound.injection.outcomes[0]!.code).toBe('fetch_failed');
      expect(notFound.lines[0]).toContain('status: 404');
      const big = await rejected(url('https://cdn.example/a.png'), transport(async () => { throw new Error('response exceeds 10 bytes'); }));
      expect(big.injection.outcomes[0]!.code).toBe('too_large');
      const pdf = await rejected(url('https://cdn.example/a.png'), transport(async () => ({ status: 200, body: Buffer.from('%PDF-1.7\n') })));
      expect(pdf.injection.outcomes[0]!.code).toBe('mime_mismatch');
      const reset = await rejected(url('https://cdn.example/a.png'), transport(async () => { throw new Error('ECONNRESET'); }));
      expect(reset.injection.outcomes[0]!.code).toBe('fetch_failed');
    });

    it('inline data: wrong type, undecodable, declared oversize — without logging the data', async () => {
      const inline = (value: string) => [{ kind: 'image' as const, source: { kind: 'base64' as const, value } }];
      const pdf = await rejected(inline(Buffer.from('%PDF-1.7\n').toString('base64')));
      expect(pdf.injection.outcomes[0]!.code).toBe('mime_mismatch');
      expect(pdf.lines[0]).toContain('scheme: base64');
      expect(pdf.lines[0]).not.toContain(Buffer.from('%PDF-1.7\n').toString('base64'));
      const broken = await rejected(inline('not*base64!'));
      expect(broken.injection.outcomes[0]!.code).toBe('invalid_data');
      const { DEFAULT_MULTIMODAL_CONFIG } = await import('../../src/media/media-types.js');
      const huge = await rejected(inline(Buffer.alloc(DEFAULT_MULTIMODAL_CONFIG.maxFileBytes + 3, 1).toString('base64')));
      expect(huge.injection.outcomes[0]!.code).toBe('too_large');
    });
  });

  describe('入站 path 归属（#1250）', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const refused = (text: string) => ({
      blocks: [],
      textAppends: [`[Media rejected:${text}: image; this message carries a local file that cannot be read]`],
      outcomes: [{ kind: 'image', status: 'rejected', code: text }],
    });
    const resolveOne = (value: string, roots?: readonly string[]) => resolveMedia(
      [{ kind: 'image', source: { kind: 'path', value } }],
      { providerInput: ['text', 'image'], ...(roots ? { inboundMediaRoots: roots } : {}) },
    );

    it('未声明入站目录的端点产出的 path 不读，降级为占位而不中断', async () => {
      const file = path.join(root, 'pic.png');
      fs.writeFileSync(file, png);
      await expect(resolveOne(file)).resolves.toMatchObject(refused('inbound_path_not_owned'));
      await expect(resolveOne(file, [])).resolves.toMatchObject(refused('inbound_path_not_owned'));
    });

    it('声明目录之外的 path 不读（例如另一个目录、目录本身、缺失文件）', async () => {
      const owned = fs.mkdtempSync(path.join(root, 'owned-'));
      const outside = path.join(root, 'outside.png');
      fs.writeFileSync(outside, png);
      await expect(resolveOne(outside, [owned])).resolves.toMatchObject(refused('inbound_path_not_owned'));
      await expect(resolveOne(owned, [owned])).resolves.toMatchObject(refused('inbound_path_not_owned'));
      await expect(resolveOne(path.join(owned, 'missing.png'), [owned])).resolves.toMatchObject(refused('inbound_path_not_owned'));
    });

    it('用 .. 逃出声明目录不读', async () => {
      const owned = fs.mkdtempSync(path.join(root, 'owned-'));
      fs.writeFileSync(path.join(root, 'secret.png'), png);
      await expect(resolveOne(`${owned}${path.sep}..${path.sep}secret.png`, [owned]))
        .resolves.toMatchObject(refused('inbound_path_not_owned'));
    });

    it.skipIf(process.platform === 'win32')('用符号链接逃出声明目录不读（文件链接与目录链接）', async () => {
      const owned = fs.mkdtempSync(path.join(root, 'owned-'));
      const elsewhere = fs.mkdtempSync(path.join(root, 'elsewhere-'));
      fs.writeFileSync(path.join(elsewhere, 'secret.png'), png);
      fs.symlinkSync(path.join(elsewhere, 'secret.png'), path.join(owned, 'link.png'));
      fs.symlinkSync(elsewhere, path.join(owned, 'dir'));
      await expect(resolveOne(path.join(owned, 'link.png'), [owned])).resolves.toMatchObject(refused('inbound_path_not_owned'));
      await expect(resolveOne(path.join(owned, 'dir', 'secret.png'), [owned])).resolves.toMatchObject(refused('inbound_path_not_owned'));
    });

    it.skipIf(process.platform === 'win32')('声明目录本身是符号链接时按真实路径比较，仍能读其中的文件', async () => {
      const real = fs.mkdtempSync(path.join(root, 'real-'));
      fs.writeFileSync(path.join(real, 'pic.png'), png);
      const linked = path.join(root, 'linked');
      fs.symlinkSync(real, linked);
      const injection = await resolveOne(path.join(linked, 'pic.png'), [linked]);
      expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
    });

    it('声明目录内但命中敏感目录 / 文件名（.zhin/、.env*、数据库）仍不读', async () => {
      const owned = fs.mkdtempSync(path.join(root, 'owned-'));
      fs.mkdirSync(path.join(owned, '.zhin'));
      for (const name of [path.join('.zhin', 'pic.png'), '.env', '.env.local', 'gateway.db']) {
        fs.writeFileSync(path.join(owned, name), png);
        await expect(resolveOne(path.join(owned, name), [owned])).resolves.toMatchObject(refused('inbound_path_sensitive'));
      }
    });

    it('file:// 形式的声明目录内路径可读；~/ 与其它 scheme 不当作本机文件', async () => {
      const file = path.join(root, 'pic.png');
      fs.writeFileSync(file, png);
      const injection = await resolveOne(pathToFileURL(file).href, [root]);
      expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
      await expect(resolveOne('~/pic.png', [root])).resolves.toMatchObject(refused('inbound_path_not_owned'));
    });

    it('平台引用物化出的 path 也按声明目录判定', async () => {
      const outside = path.join(root, 'outside.png');
      fs.writeFileSync(outside, png);
      const owned = fs.mkdtempSync(path.join(root, 'owned-'));
      const references = {
        async resolve() {
          return { status: 'resolved' as const, content: { kind: 'path' as const, value: outside } };
        },
      };
      const injection = await resolveMedia([{
        kind: 'image', source: { kind: 'platform_ref', value: 'opaque' }, referenceKey: 'ref-1',
      }], { references, providerInput: ['text', 'image'], inboundMediaRoots: [owned] });
      expect(injection).toMatchObject(refused('inbound_path_not_owned'));
    });

    it('一条消息里被拒的 path 不影响其它媒体', async () => {
      const injection = await resolveMedia([
        { kind: 'image', source: { kind: 'path', value: '/etc/hostname' } },
        { kind: 'image', source: { kind: 'base64', value: png.toString('base64') } },
      ], { providerInput: ['text', 'image'] });
      expect(injection.outcomes).toEqual([
        { kind: 'image', status: 'rejected', code: 'inbound_path_not_owned' },
        { kind: 'image', status: 'accepted', code: 'validated_provider_input' },
      ]);
      expect(injection.blocks).toHaveLength(1);
    });
  });

  it('image：端点声明的协议端 origin 可用自身端口，其他非默认端口仍拒（#1250 第 48 批）', async () => {
    const requested: string[] = [];
    const transport: NetworkTransport = {
      request: async () => { throw new Error('text request not expected'); },
      requestBytes: async (url: URL) => { requested.push(url.href); return { status: 200, statusText: 'OK', headers: {}, body: bytesFor(url.href) }; },
    };
    const injection = await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'url', value: 'https://satori.example:5140/v1/proxy/a.jpg' } },
      { kind: 'image', source: { kind: 'url', value: 'https://satori.example:6379/b.jpg' } },
      { kind: 'image', source: { kind: 'url', value: 'https://cdn.example/c.jpg' } },
    ], { mediaTransport: transport, inboundMediaOrigins: ['https://satori.example:5140'], providerInput: ['text', 'image'] });
    expect(requested).toEqual(['https://satori.example:5140/v1/proxy/a.jpg', 'https://cdn.example/c.jpg']);
    expect(injection.blocks).toHaveLength(2);

    requested.length = 0;
    await resolveTurnMediaInjection([
      { kind: 'image', source: { kind: 'url', value: 'https://satori.example:5140/v1/proxy/a.jpg' } },
    ], { mediaTransport: transport, providerInput: ['text', 'image'] });
    expect(requested).toEqual([]);
  });

  it('audio / video / file 保留给显式支持相应输入的 provider', async () => {
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]).toString('base64');
    const injection = await resolveMedia([
      { kind: 'audio', source: { kind: 'base64', value: mp3 }, mimeType: 'audio/mpeg' },
      { kind: 'video', source: { kind: 'url', value: 'https://cdn.example/v.mp4' } },
      { kind: 'file', source: { kind: 'url', value: 'https://cdn.example/f.zip' }, name: 'f.zip' },
    ], { signal: new AbortController().signal, providerInput: ['text', 'audio', 'video', 'file'] });
    expect(injection.blocks.map((block) => block.type)).toEqual(['audio', 'video', 'file']);
    expect(injection.textAppends).toEqual([]);
    expect(injection.outcomes).toEqual([
      { kind: 'audio', status: 'accepted', code: 'validated_provider_input' },
      { kind: 'video', status: 'accepted', code: 'validated_provider_input' },
      { kind: 'file', status: 'accepted', code: 'validated_provider_input' },
    ]);
  });

  it('audio transcription uses only the explicitly injected host port', async () => {
    const transcribe = vi.fn(async () => '宿主转写结果');
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]).toString('base64');
    const signal = new AbortController().signal;
    const injection = await resolveMedia([
      { kind: 'audio', source: { kind: 'base64', value: mp3 }, mimeType: 'audio/mpeg' },
    ], {
      signal,
      providerInput: ['text'],
      transcriber: { transcribe },
    });

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'audio',
      mimeType: 'audio/mpeg',
    }), signal);
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toEqual(['[语音转写] 宿主转写结果']);
    expect(injection.outcomes).toEqual([
      { kind: 'audio', status: 'derived', code: 'speech_transcription' },
    ]);
  });

  it('platform_ref 无 key / 无 resolver：走统一拒绝路径（unmaterialized_platform_reference + 日志）', async () => {
    const { getLogger } = await import('@zhin.js/logger');
    const warn = vi.spyOn(getLogger('ZhinAgent'), 'warn').mockImplementation(() => undefined);
    try {
      const injection = await resolveMedia([
        { kind: 'image', source: { kind: 'platform_ref', value: 'opaque-image-id' } },
      ], { scene: 'qq/group/42', messageId: 'm-9' });
      expect(injection.blocks).toEqual([]);
      expect(injection.textAppends).toEqual(['[Media rejected:unmaterialized_platform_reference: image]']);
      expect(injection.outcomes).toEqual([
        { kind: 'image', status: 'rejected', code: 'unmaterialized_platform_reference' },
      ]);
      const lines = warn.mock.calls.map(call => String(call[0])).filter(line => line.includes('inbound_media_rejected'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('reason: unmaterialized_platform_reference');
      expect(lines[0]).toContain('scene: qq/group/42');
      expect(lines[0]).toContain('scheme: platform');
      expect(lines[0]).not.toContain('opaque-image-id');
    } finally { warn.mockRestore(); }
  });

  it('平台引用解析失败：日志 reason 统一为 unmaterialized_platform_reference，结局与占位保留解析器的具体码', async () => {
    const { getLogger } = await import('@zhin.js/logger');
    const warn = vi.spyOn(getLogger('ZhinAgent'), 'warn').mockImplementation(() => undefined);
    try {
      const injection = await resolveMedia([
        { kind: 'image', source: { kind: 'platform_ref', value: 'opaque-1' }, referenceKey: 'ref-1' },
        { kind: 'image', source: { kind: 'platform_ref', value: 'opaque-2' }, referenceKey: 'ref-2' },
      ], { scene: 'qq/group/42', references: {
        resolve: async key => key === 'ref-1'
          ? { status: 'expired', code: 'reference_expired' }
          : { status: 'forbidden', code: 'reference_forbidden' },
      }, signal: new AbortController().signal, providerInput: ['text', 'image'] });
      expect(injection.outcomes).toEqual([
        { kind: 'image', status: 'failed', code: 'reference_expired' },
        { kind: 'image', status: 'rejected', code: 'reference_forbidden' },
      ]);
      expect(injection.textAppends).toEqual(['[Media failed:reference_expired: image]', '[Media failed:reference_forbidden: image]']);
      const lines = warn.mock.calls.map(call => String(call[0])).filter(line => line.includes('inbound_media_rejected'));
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line).toContain('reason: unmaterialized_platform_reference');
      expect(lines[0]).toContain('detail: reference_expired');
      expect(lines[1]).toContain('detail: reference_forbidden');
    } finally { warn.mockRestore(); }
  });

  it('path 超过 maxFileBytes 且未声明大小 → too_large（不是 file_unreadable）', async () => {
    const { DEFAULT_MULTIMODAL_CONFIG } = await import('../../src/media/media-types.js');
    const file = path.join(root, 'huge.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    fs.truncateSync(file, DEFAULT_MULTIMODAL_CONFIG.maxFileBytes + 1);
    const injection = await resolveMedia([{ kind: 'image', source: { kind: 'path', value: file } }],
      { providerInput: ['text', 'image'], inboundMediaRoots: [root] });
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'rejected', code: 'too_large' }]);
    const missing = await resolveMedia([{ kind: 'image', source: { kind: 'path', value: path.join(root, 'gone.png') } }],
      { providerInput: ['text', 'image'], inboundMediaRoots: [root] });
    expect(missing.outcomes[0]!.status).toBe('rejected');
    expect(missing.outcomes[0]!.code).not.toBe('too_large');
  });

  it('Provider 省略输入能力声明时按 text-only 处理并产生 unsupported 终态', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
    const injection = await resolveMedia([
      { kind: 'image', source: { kind: 'base64', value: png }, mimeType: 'image/png' },
    ]);

    expect(injection.blocks).toEqual([]);
    expect(injection.outcomes).toEqual([
      { kind: 'image', status: 'unsupported', code: 'provider_input' },
    ]);
    expect(injection.textAppends).toEqual(['[Media unsupported:provider_input: image]']);
  });

  it('通过当前 turn 的 ReferencePort 物化 platform_ref', async () => {
    const injection = await resolveMedia([{
      kind: 'image',
      source: { kind: 'platform_ref', value: 'opaque-image-id' },
      referenceKey: 'ref-1',
    }], { references: {
      async resolve(key) {
        expect(key).toBe('ref-1');
        return {
          status: 'resolved',
          content: { kind: 'url', value: 'https://cdn.example/resolved.png', mime_type: 'image/png' },
        };
      },
    }, signal: new AbortController().signal, providerInput: ['text', 'image'] });
    expect(injection.blocks[0]).toMatchObject({
      type: 'image',
      data: { media: { kind: 'base64', mime_type: 'image/png' } },
    });
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
  });
});

const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');

function fakePerception(
  describe: MediaPerceptionPort['describe'],
  overrides: Partial<MediaPerceptionPort> = {},
): MediaPerceptionPort & { calls: number } {
  const port = {
    calls: 0,
    kinds: ['image'] as const,
    maxItemsPerTurn: 4,
    accepts: (payload: { kind: string }) => payload.kind === 'image',
    describe: async (...args: Parameters<MediaPerceptionPort['describe']>) => {
      port.calls += 1;
      return describe(...args);
    },
    ...overrides,
  };
  return port as MediaPerceptionPort & { calls: number };
}

describe('resolveTurnMediaInjection — perception pre-pass', () => {
  const pngTurn = () => ({ kind: 'image' as const, source: { kind: 'base64' as const, value: PNG_B64 }, mimeType: 'image/png' });

  it('text-only model + image → derived description, framed untrusted, with provenance', async () => {
    const perception = fakePerception(async () => ({ text: '白底红色圆形', provider: 'g', model: 'flash-lite', cached: false }));
    const injection = await resolveMedia([pngTurn()], { providerInput: ['text'], perception });
    expect(injection.blocks).toEqual([]);
    expect(injection.textAppends).toHaveLength(1);
    expect(injection.textAppends[0]).toMatch(/^\[图片描述\] \[Untrusted media description/);
    expect(injection.textAppends[0]).toContain('source=external_content) 白底红色圆形');
    expect(injection.outcomes).toEqual([{
      kind: 'image', status: 'derived', code: 'media_perception',
      provenance: { source: 'media_perception', provider: 'g', model: 'flash-lite', cached: false },
      description: '白底红色圆形',
    }]);
    // #1250: a fresh description is a provider call even when the port reported no usage; it counts with
    // zero tokens marked as not reported (usage rows store unknown). Earlier this was no call at all.
    expect(injection.perceptionCalls).toEqual([expect.objectContaining({ provider: 'g', model: 'flash-lite', status: 'completed',
      usageReported: false, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } })]);
  });

  it('notes after a perception description that the media needs no second look by another agent (#1250 vision-ask-after-perception)', async () => {
    const { perceptionDelegationNote, PERCEPTION_DELEGATION_NOTE } = await import('../../src/turn/inbound-media.js');
    const perception = fakePerception(async () => ({ text: 'Octocat', provider: 'g', model: 'm', cached: true }));
    const described = await resolveMedia([pngTurn()], { providerInput: ['text'], perception });
    expect(perceptionDelegationNote(described.outcomes)).toBe(PERCEPTION_DELEGATION_NOTE);
    expect(PERCEPTION_DELEGATION_NOTE).toMatch(/do not ask or delegate another agent/u);
    const accepted = await resolveMedia([pngTurn()], { providerInput: ['text', 'image'] });
    expect(perceptionDelegationNote(accepted.outcomes)).toBeUndefined();
  });

  it('lists each perception request that reached a provider, including failed ones (#1250)', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    let call = 0;
    const perception = fakePerception(async () => {
      call += 1;
      if (call === 2) {
        const failed = { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 };
        throw new MediaPerceptionFailedError(new Error('boom'), failed,
          [{ provider: 'b', model: 'backup', status: 'failed', usage: failed, usageReported: false, durationMs: 1 }]);
      }
      return { text: '图', provider: 'g', model: 'm', cached: false, usage };
    });
    const injection = await resolveMedia([pngTurn(), pngTurn()], { providerInput: ['text'], perception });
    expect(injection.perceptionCalls).toEqual([
      expect.objectContaining({ kind: 'image', provider: 'g', model: 'm', usage, status: 'completed' }),
      expect.objectContaining({ kind: 'image', provider: 'b', model: 'backup', status: 'failed', usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 } }),
    ]);
  });

  it('reports every request the port made, one per candidate, and still reports them when the turn is cancelled (#1250)', async () => {
    const reported = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
    const estimate = { prompt_tokens: 1_050, completion_tokens: 0, total_tokens: 1_050 };
    const fallback = fakePerception(async (_payload, _signal, observe) => {
      observe?.({ provider: 'svc-a', model: 'primary', status: 'failed', usage: estimate, usageReported: false, durationMs: 5 });
      observe?.({ provider: 'svc-b', model: 'backup', status: 'completed', usage: reported, usageReported: true, durationMs: 7 });
      return { text: '图', provider: 'b', model: 'backup', cached: false, usage: { prompt_tokens: 1_060, completion_tokens: 2, total_tokens: 1_062 } };
    });
    const seen: unknown[] = [];
    const injection = await resolveMedia([pngTurn()], { providerInput: ['text'], perception: fallback, onPerceptionCall: call => seen.push(call) });
    expect(injection.perceptionCalls).toEqual([
      expect.objectContaining({ provider: 'svc-a', model: 'primary', status: 'failed', usage: estimate, usageReported: false }),
      expect.objectContaining({ provider: 'svc-b', model: 'backup', status: 'completed', usage: reported, usageReported: true }),
    ]);
    expect(seen).toEqual(injection.perceptionCalls);

    const controller = new AbortController();
    const cancelled = fakePerception(async (_payload, _signal, observe) => {
      controller.abort(new Error('stopped'));
      observe?.({ provider: 'svc-a', model: 'primary', status: 'cancelled', usage: estimate, usageReported: false, durationMs: 3 });
      throw new Error('aborted');
    });
    const during: unknown[] = [];
    await expect(resolveMedia([pngTurn()], { providerInput: ['text'], perception: cancelled, signal: controller.signal,
      onPerceptionCall: call => during.push(call) })).rejects.toThrow();
    expect(during).toEqual([expect.objectContaining({ status: 'cancelled', provider: 'svc-a' })]);
  });

  it('sums perception usage across items (including empty descriptions) into perceptionUsage', async () => {
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    const perception = fakePerception(async () => ({ text: '图', provider: 'g', model: 'm', cached: false, usage }));
    const empty = fakePerception(async () => ({ text: ' ', provider: 'g', model: 'm', cached: false, usage }));
    const cached = fakePerception(async () => ({ text: '图', provider: 'g', model: 'm', cached: true }));
    const two = await resolveMedia([pngTurn(), pngTurn()], { providerInput: ['text'], perception });
    expect(two.perceptionUsage).toEqual({ prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 });
    const spent = await resolveMedia([pngTurn()], { providerInput: ['text'], perception: empty });
    expect(spent.perceptionUsage?.total_tokens).toBe(120);
    const none = await resolveMedia([pngTurn()], { providerInput: ['text'], perception: cached });
    expect(none.perceptionUsage).toBeUndefined();
  });

  it('bills a perception call that failed after it was sent', async () => {
    const usage = { prompt_tokens: 1_050, completion_tokens: 0, total_tokens: 1_050 };
    const failing = fakePerception(async () => { throw new MediaPerceptionFailedError(new Error('503'), usage); });
    const result = await resolveMedia([pngTurn()], { providerInput: ['text'], perception: failing });
    expect(result.perceptionUsage).toEqual(usage);
  });

  it('a model that takes images gets the image itself; perception is not called', async () => {
    const perception = fakePerception(async () => ({ text: 'x', provider: 'g', model: 'm', cached: false }));
    const injection = await resolveMedia([pngTurn()], { providerInput: ['text', 'image'], perception });
    expect(injection.outcomes).toEqual([{ kind: 'image', status: 'accepted', code: 'validated_provider_input' }]);
    expect(perception.calls).toBe(0);
  });

  it('perception failure (throw or empty) → today\'s placeholder', async () => {
    const failing = fakePerception(async () => { throw new Error('503'); });
    const empty = fakePerception(async () => ({ text: '  ', provider: 'g', model: 'm', cached: false }));
    for (const perception of [failing, empty]) {
      const injection = await resolveMedia([pngTurn()], { providerInput: ['text'], perception });
      expect(injection.textAppends).toEqual(['[Media unsupported:provider_input: image]']);
      expect(injection.outcomes).toEqual([{ kind: 'image', status: 'unsupported', code: 'provider_input' }]);
    }
  });

  it('kinds not accepted by the port keep the placeholder', async () => {
    const perception = fakePerception(async () => ({ text: 'x', provider: 'g', model: 'm', cached: false }), { accepts: () => false });
    const injection = await resolveMedia([pngTurn()], { providerInput: ['text'], perception });
    expect(injection.outcomes[0]).toMatchObject({ status: 'unsupported', code: 'provider_input' });
    expect(perception.calls).toBe(0);
  });

  it('maxItemsPerTurn bounds the perception calls; the rest keep placeholders', async () => {
    const perception = fakePerception(async () => ({ text: '图', provider: 'g', model: 'm', cached: false }), { maxItemsPerTurn: 2 });
    const injection = await resolveMedia([pngTurn(), pngTurn(), pngTurn()], { providerInput: ['text'], perception });
    expect(perception.calls).toBe(2);
    expect(injection.outcomes.map((outcome) => outcome.code)).toEqual(['media_perception', 'media_perception', 'provider_input']);
  });

  it('audio stays on STT first; perception is never asked for audio', async () => {
    const perception = fakePerception(async () => ({ text: 'x', provider: 'g', model: 'm', cached: false }), { accepts: () => true });
    const wav = Buffer.from('RIFF\0\0\0\0WAVEfmt ').toString('base64');
    const injection = await resolveMedia([
      { kind: 'audio', source: { kind: 'base64', value: wav }, mimeType: 'audio/wav' },
    ], { providerInput: ['text'], perception, transcriber: { transcribe: async () => '你好' } });
    expect(injection.textAppends).toEqual(['[语音转写] 你好']);
    expect(perception.calls).toBe(0);
  });

  it('an abort during perception propagates instead of degrading to a placeholder', async () => {
    const controller = new AbortController();
    const perception = fakePerception(async () => {
      controller.abort(new Error('cancelled'));
      throw new Error('aborted');
    });
    await expect(resolveMedia([pngTurn()], { providerInput: ['text'], perception, signal: controller.signal }))
      .rejects.toThrow('cancelled');
  });
});

describe('applyInboundMediaInjection', () => {
  it('媒体块与文本补充挂到最后一个 user 消息，历史不动', () => {
    const history = createUserMessage('旧消息');
    const current = createUserMessage('看这个');
    const out = applyInboundMediaInjection([history, current], {
      blocks: [{
        type: 'image',
        data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' } },
      }],
      textAppends: ['[语音转写] 你好'],
      outcomes: [],
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(history);
    const updated = out[1] as ReturnType<typeof createUserMessage>;
    expect(updated.media).toEqual([{
      type: 'image',
      data: { media: { kind: 'url', value: 'https://cdn.example/a.jpg' } },
    }]);
    expect(updated.content.map((b) => (b as { text?: string }).text)).toEqual(['看这个', '[语音转写] 你好']);
  });

  it('空注入原样返回', () => {
    const messages = [createUserMessage('hi')];
    const out = applyInboundMediaInjection(messages, { blocks: [], textAppends: [], outcomes: [] });
    expect(out[0]).toBe(messages[0]);
  });
});
