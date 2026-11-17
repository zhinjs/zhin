import { describe, expect, it, vi } from 'vitest';
import {
  createSandboxHostedMediaResolver,
  filesOfTransfer,
  sandboxHostedConsoleUrl,
  sandboxUploadedSegment,
  uploadSandboxMedia,
} from '../pages/index/sandboxMedia.js';
import { sandboxInboundMediaSegment } from '../src/inbound-syntax.js';
import { isSandboxMediaPath } from '../src/media-url.js';

const id = 'Abc_def-0123456789ABCD';
const url = `http://127.0.0.1:8086/pub/sandbox-media/0123456789abcdef/${id}?exp=1900000000&sig=${'s'.repeat(43)}`;
const context = { apiBase: 'https://bot.example', headers: { Authorization: 'Bearer t' } };
const scene = { type: 'group' as const, id: 'room 1' };

describe('Sandbox page media helpers (ADR 0064 D13, I1)', () => {
  it('builds the same segment as the typed syntax, with type, size and name', () => {
    for (const kind of ['image', 'audio', 'video', 'file'] as const) {
      const reply = { id, kind, mime: 'x/y', size: 3, name: 'a.bin', expiresAt: 1, url };
      expect(sandboxUploadedSegment(reply)).toEqual(sandboxInboundMediaSegment(kind, url, { mime_type: 'x/y', size: 3, file_name: 'a.bin' }));
      expect(sandboxUploadedSegment(reply).data.media).toMatchObject({ kind: 'url', value: url });
    }
  });

  it('maps a failed upload and a network error to ok: false without throwing', async () => {
    const refused = await uploadSandboxMedia(new Blob(['x']), { endpointId: 'bot', scene, context,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'too_large', error: 'too big' }), { status: 413 })) });
    expect(refused).toEqual({ ok: false, code: 'too_large', message: 'too big' });
    const offline = await uploadSandboxMedia(new Blob(['x']), { endpointId: 'bot', scene, context, fetchImpl: vi.fn(async () => { throw new Error('offline'); }) });
    expect(offline).toEqual({ ok: false, code: 'network', message: 'offline' });
  });

  it('shows hosted links through the Console download of the same conversation, with credentials', async () => {
    expect(sandboxHostedConsoleUrl(url, { endpointId: 'bot', scene, context }))
      .toBe(`https://bot.example/api/sandbox/media/bot/${id}?type=group&id=room+1`);
    expect(sandboxHostedConsoleUrl('https://cdn.example/a.png', { endpointId: 'bot', scene, context })).toBeUndefined();
    const fetchImpl = vi.fn(async () => new Response(new Blob(['png']), { status: 200 }));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:1'), revokeObjectURL: vi.fn() }));
    const resolver = createSandboxHostedMediaResolver({ endpointId: 'bot', scene, context, fetchImpl });
    expect(await resolver.resolve(url)).toBe('blob:1');
    expect(await resolver.resolve(url)).toBe('blob:1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`https://bot.example/api/sandbox/media/bot/${id}?type=group&id=room+1`, { headers: { Authorization: 'Bearer t' } });
    resolver.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    const gone = createSandboxHostedMediaResolver({ endpointId: 'bot', scene, context, fetchImpl: vi.fn(async () => new Response(null, { status: 404 })) });
    expect(await gone.resolve(url)).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('reads files from a paste or drop, and only claims the hosted prefix', () => {
    const file = new File(['x'], 'a.txt');
    expect(filesOfTransfer({ files: [file] as unknown as FileList, items: [] as unknown as DataTransferItemList })).toEqual([file]);
    expect(filesOfTransfer({ files: [] as unknown as FileList,
      items: [{ kind: 'string', getAsFile: () => null }, { kind: 'file', getAsFile: () => file }] as unknown as DataTransferItemList })).toEqual([file]);
    expect(filesOfTransfer(null)).toEqual([]);
    expect(isSandboxMediaPath(url)).toBe(true);
    expect(isSandboxMediaPath('https://cdn.example/pub/sandbox-mediax/a')).toBe(false);
  });
});
