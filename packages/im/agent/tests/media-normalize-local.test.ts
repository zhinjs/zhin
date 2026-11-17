import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fetchUrlAsBase64, normalizeMediaRefsToPayloads } from '../src/media/media-normalize.js';

describe('normalizeMediaRefsToPayloads local files', () => {
  it('reads local image path ref into base64 payload', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-'));
    const filePath = path.join(dir, 'test.png');
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await fs.writeFile(filePath, pngHeader);

    const payloads = await normalizeMediaRefsToPayloads(
      [{ type: 'image', media: { kind: 'path', value: filePath } }],
      1024 * 1024,
      undefined,
      { filesystem: { workspaceRoot: dir }, fileRole: 'owner' },
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.kind).toBe('image');
    expect(payloads[0]?.mimeType).toBe('image/png');
    expect(payloads[0]?.base64.length).toBeGreaterThan(0);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not read a local path without a filesystem authority (#1250)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-'));
    const filePath = path.join(dir, 'test.png');
    await fs.writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    try {
      await expect(normalizeMediaRefsToPayloads(
        [{ type: 'image', media: { kind: 'path', value: filePath } }],
        1024 * 1024,
      )).resolves.toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('skips platform-opaque file refs', async () => {
    const payloads = await normalizeMediaRefsToPayloads(
      [{ type: 'image', media: { kind: 'file', value: 'telegram-file-id' } }],
      1024 * 1024,
    );
    expect(payloads).toHaveLength(0);
  });

  it('reads base64 refs directly with segment type as kind hint', async () => {
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
    const payloads = await normalizeMediaRefsToPayloads(
      [{ type: 'audio', media: { kind: 'base64', value: mp3.toString('base64'), mime_type: 'image/png' } }],
      1024 * 1024,
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.kind).toBe('audio');
    expect(payloads[0]?.mimeType).toBe('audio/mpeg');
    expect(payloads[0]?.base64).toBe(mp3.toString('base64'));
  });

  it('rejects a spoofed media kind instead of trusting its extension or declared MIME', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-media-'));
    const filePath = path.join(dir, 'pretend.png');
    await fs.writeFile(filePath, Buffer.from('%PDF-1.7\n'));

    await expect(normalizeMediaRefsToPayloads(
      [{ type: 'image', media: { kind: 'path', value: filePath, mime_type: 'image/png' } }],
      1024 * 1024,
      undefined,
      { filesystem: { workspaceRoot: dir }, fileRole: 'owner' },
    )).resolves.toEqual([]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('rejects non-HTTPS and private media URLs before issuing a request', async () => {
    const called: string[] = [];
    const transport = {
      request: async () => { throw new Error('text request not expected'); },
      requestBytes: async (url: URL) => {
        called.push(url.href);
        return { status: 200, statusText: 'OK', headers: {}, body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
      },
    };
    await expect(fetchUrlAsBase64('http://example.com/image.png', 1024, 'image', undefined, [], transport)).resolves.toBeNull();
    await expect(fetchUrlAsBase64('https://127.0.0.1/image.png', 1024, 'image', undefined, [], transport)).resolves.toBeNull();
    expect(called).toEqual([]);
    await expect(fetchUrlAsBase64('https://example.com/image.png', 1024, 'image', undefined, [], transport)).resolves.toMatchObject({ kind: 'image' });
    expect(called).toEqual(['https://example.com/image.png']);
  });

});
