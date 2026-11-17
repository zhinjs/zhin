import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractFromTextAndSegments } from '../src/index.js';
import { authorizeInboundImagePath, confineInboundImagePaths } from '../src/inbound-media-path.js';
import { HttpModerationProvider } from '../src/providers/http.js';

let base: string;
let root: string;
let secret: string;

beforeEach(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'moderation-inbound-')));
  root = path.join(base, 'endpoint', 'media', 'inbound');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  secret = path.join(base, 'secret.env');
  await writeFile(secret, 'TOKEN=1');
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

describe('inbound image paths (#1250)', () => {
  it('keeps only paths whose real path lies inside a declared root', async () => {
    expect(await authorizeInboundImagePath(path.join(root, 'pic.png'), [root])).toBe(path.join(root, 'pic.png'));
    expect(await authorizeInboundImagePath(pathToFileURL(path.join(root, 'pic.png')).href, [root])).toBe(path.join(root, 'pic.png'));
    expect(await authorizeInboundImagePath(secret, [root])).toBeUndefined();
    expect(await authorizeInboundImagePath(path.join(root, '..', '..', '..', 'secret.env'), [root])).toBeUndefined();
    expect(await authorizeInboundImagePath(pathToFileURL(secret).href, [root])).toBeUndefined();
    expect(await authorizeInboundImagePath('~/secret.env', [root])).toBeUndefined();
    expect(await authorizeInboundImagePath(root, [root])).toBeUndefined();
    expect(await authorizeInboundImagePath(path.join(root, 'pic.png'), [])).toBeUndefined();
  });

  it('refuses a symbolic link inside the root that points outside it', async () => {
    await symlink(secret, path.join(root, 'link.png'));
    expect(await authorizeInboundImagePath(path.join(root, 'link.png'), [root])).toBeUndefined();
  });

  it('never guesses a legacy data.file to be a host path', () => {
    const extracted = extractFromTextAndSegments('', [{ type: 'image', data: { file: '/etc/passwd' } }]);
    expect(extracted.images).toEqual([{ index: 0, segmentIndex: 0 }]);
  });

  it('the HTTP provider never reads a path outside the declared roots', async () => {
    const extracted = extractFromTextAndSegments('', [
      { type: 'image', data: { media: { kind: 'path', value: secret } } },
      { type: 'image', data: { media: { kind: 'path', value: path.join(root, 'pic.png') } } },
    ]);
    const images = await confineInboundImagePaths(extracted.images, [root]);
    expect(images.map(image => image.path)).toEqual([undefined, path.join(root, 'pic.png')]);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      const uploads = form.getAll('images').filter((item): item is File => typeof item !== 'string');
      expect(uploads).toHaveLength(1);
      expect(Buffer.from(await uploads[0]!.arrayBuffer()).toString()).not.toContain('TOKEN');
      return new Response(JSON.stringify({ severity: 'pass' }), { status: 200 });
    });
    const provider = new HttpModerationProvider({
      id: 'http-1', type: 'http', enabled: true, onError: 'closed',
      url: 'https://moderation.example/scan', headers: {}, timeoutMs: 1000, forceUpload: false,
    }, { fetch: fetchImpl as unknown as typeof fetch });
    await provider.scan({ text: '', images, direction: 'inbound', context: { adapter: 'a', endpoint: 'e', conversationKind: 'private', conversationId: 'c' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('inbound middleware media roots (#1250)', () => {
  it('hands the engine only the image paths inside the Endpoint\'s declared roots', async () => {
    const { default: inbound } = await import('../middlewares/inbound/index.ts');
    const { moderationEngineToken } = await import('../src/runtime.js');
    const apply = vi.fn(async (_input: unknown) => ({ continue: true }));
    const inboundMediaRoots = vi.fn((_id: string) => [root]);
    const message = {
      endpointId: 'bot', id: 'm1', sender: { id: 'u1' }, locale: 'zh-CN', content: '[图片]',
      conversation: { endpoint: { adapter: 'weixin-ilink', id: 'canonical:bot' }, kind: 'private', id: 'u1' },
      segments: [
        { type: 'image', data: { media: { kind: 'path', value: secret } } },
        { type: 'image', data: { media: { kind: 'path', value: path.join(root, 'pic.png') } } },
      ],
      metadata: {},
    };
    const next = vi.fn(async () => undefined);
    await inbound.handle({
      config: {}, input: message, signal: new AbortController().signal,
      use: (token: { id: string }) => {
        if (token.id === moderationEngineToken.id) return { apply };
        throw new Error('Missing resource');
      },
      project: () => ({ inboundMediaRoots }),
    } as never, next as never);
    expect(inboundMediaRoots).toHaveBeenCalledWith('canonical:bot');
    const input = apply.mock.calls[0]![0] as { scanInput: { images: { path?: string }[] }; extracted: { images: { path?: string }[] } };
    expect(input.scanInput.images.map(image => image.path)).toEqual([undefined, path.join(root, 'pic.png')]);
    expect(input.extracted.images.map(image => image.path)).toEqual([undefined, path.join(root, 'pic.png')]);
    expect(next).toHaveBeenCalledOnce();
  });
});
