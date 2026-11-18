import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES } from '../../../../packages/host/gateway/src/http/gateway-http-server.js';
import { inspectMediaBytes } from '../../../../packages/im/agent/src/media/media-normalize.js';
import {
  SANDBOX_MEDIA_DEFAULTS,
  SANDBOX_MEDIA_HARD_MAX_FILE_BYTES,
  SANDBOX_MEDIA_MAX_OBJECTS,
  SANDBOX_MEDIA_MAX_OBJECTS_PER_UPLOADER,
  resolveSandboxMediaConfig,
  type ResolvedSandboxMediaConfig,
} from '../src/media-config.js';
import {
  SandboxMediaError,
  SandboxMediaStore,
  sandboxMediaDirKey,
  sniffSandboxMedia,
  type SandboxMediaConversation,
} from '../src/media-store.js';
import { parseSandboxMediaUrl } from '../src/media-url.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const room: SandboxMediaConversation = { endpoint: 'bot', type: 'group', id: 'room-1' };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function body(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([bytes]).stream();
}

async function store(config: Partial<ResolvedSandboxMediaConfig> = {}, clock = { now: 1_800_000_000_000 }) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-sandbox-media-'));
  roots.push(root);
  const media = new SandboxMediaStore({ root: join(root, '.zhin', 'sandbox', 'media'), endpointId: 'bot',
    config: { ...SANDBOX_MEDIA_DEFAULTS, ...config }, now: () => clock.now });
  return { media, root, clock };
}

async function put(media: SandboxMediaStore, bytes: Uint8Array, extra: Partial<Parameters<SandboxMediaStore['put']>[0]> = {}) {
  return media.put({ body: body(bytes), declaredLength: bytes.byteLength, declaredType: 'image/png', conversation: room, uploader: 'user:alice', ...extra });
}

describe('Sandbox media store (ADR 0064 D12, I1)', () => {
  it('names objects by a 128-bit random id only, and refuses ids that are paths', async () => {
    const { media, root } = await store();
    const meta = await put(media, PNG, { fileName: '照片 1.png' });
    expect(meta.id).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    const files = await readdir(join(root, '.zhin', 'sandbox', 'media', sandboxMediaDirKey('bot')));
    expect(files.sort()).toEqual([meta.id, `${meta.id}.json`].sort());
    expect(meta.name).toBe('照片 1.png');
    for (const id of ['../secret', '..%2Fsecret', `${meta.id}/../x`, `${meta.id}.json`, 'secret', '', '/etc/passwd', `../${sandboxMediaDirKey('bot')}/${meta.id}`]) {
      expect(media.get(id), id).toBeUndefined();
      expect(media.delete(id), id).toBe(false);
    }
    expect(media.get(meta.id)?.id).toBe(meta.id);
  });

  it('refuses a file name with any path component', async () => {
    const { media } = await store();
    for (const fileName of ['../x.png', 'a/b.png', 'a\\b.png', '..', '.', 'x\u0000.png', ' lead.png']) {
      await expect(put(media, PNG, { fileName }), fileName).rejects.toMatchObject({ code: 'invalid_name', status: 400 });
    }
    expect(media.list()).toEqual([]);
  });

  it('signs with HMAC, compares in constant time, and refuses a tampered or foreign link', async () => {
    const { media } = await store();
    const meta = await put(media, PNG);
    const url = media.signedUrl(meta, 'http://127.0.0.1:8086');
    const address = parseSandboxMediaUrl(url)!;
    expect(address).toMatchObject({ id: meta.id, dir: sandboxMediaDirKey('bot'), exp: Math.floor(meta.expiresAt / 1000) });
    vi.mocked(crypto.timingSafeEqual).mockClear();
    expect(media.verifyUrl(url)).toMatchObject({ ok: true });
    expect(crypto.timingSafeEqual).toHaveBeenCalled();
    // The origin is not part of the decision: only the prefix, the format and the HMAC are.
    expect(media.verifyUrl(url.replace('http://127.0.0.1:8086', 'https://elsewhere.example'))).toMatchObject({ ok: true });
    const flipped = address.sig[0] === 'A' ? `B${address.sig.slice(1)}` : `A${address.sig.slice(1)}`;
    expect(media.verifyUrl(url.replace(address.sig, flipped))).toEqual({ ok: false, reason: 'signature' });
    expect(media.verifyUrl(url.replace(`exp=${address.exp}`, `exp=${address.exp + 3600}`))).toEqual({ ok: false, reason: 'signature' });
    const other = await put(media, PNG);
    expect(media.verifyUrl(url.replace(meta.id, other.id))).toEqual({ ok: false, reason: 'signature' });
    for (const bad of [`${url}&x=1`, `${url}#frag`, url.replace('/pub/sandbox-media/', '/pub/other/'), url.replace(sandboxMediaDirKey('bot'), '0000000000000000')]) {
      expect(media.verifyUrl(bad).ok, bad).toBe(false);
    }
  });

  it('accepts only the exact address it issued: no encoded, reordered, repeated or re-cased parameters, one spelling of the signature', async () => {
    const { media } = await store();
    const meta = await put(media, PNG);
    const url = media.signedUrl(meta, 'http://127.0.0.1:8086');
    const address = parseSandboxMediaUrl(url)!;
    const base = url.split('?')[0]!;
    for (const bad of [
      `${base}?%65xp=${address.exp}&sig=${address.sig}`,
      `${base}?exp=${address.exp}&%73ig=${address.sig}`,
      `${base}?sig=${address.sig}&exp=${address.exp}`,
      `${base}?exp=${address.exp}&sig=${address.sig}&exp=${address.exp}`,
      `${base}?exp=${address.exp}&exp=${address.exp}`,
      `${base}?EXP=${address.exp}&SIG=${address.sig}`,
      `${base}?exp=0${address.exp}&sig=${address.sig}`,
      `${base}?exp=${address.exp}&sig=${address.sig}&`,
      `${base}?&exp=${address.exp}&sig=${address.sig}`,
      `${base}?exp=${address.exp}&sig=${address.sig.slice(0, 20)}%2B${address.sig.slice(21)}`,
    ]) {
      expect(parseSandboxMediaUrl(bad), bad).toBeUndefined();
      expect(media.verifyUrl(bad).ok, bad).toBe(false);
    }
    // 43 base64url characters carry 258 bits for a 256-bit digest: the last character has spare
    // bits, so three other spellings decode to the same bytes. Only the canonical one verifies.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const accepted = [...alphabet].map(char => url.replace(address.sig, `${address.sig.slice(0, -1)}${char}`)).filter(variant => media.verifyUrl(variant).ok);
    expect(accepted).toEqual([url]);
  });

  it('verifies links signed with the previous key after a rotation; revoke-all voids every link', async () => {
    const { media } = await store();
    const meta = await put(media, PNG);
    const before = media.signedUrl(meta, 'http://h');
    media.rotate();
    const after = media.signedUrl(meta, 'http://h');
    expect(after).not.toBe(before);
    expect(media.verifyUrl(before)).toMatchObject({ ok: true });
    expect(media.verifyUrl(after)).toMatchObject({ ok: true });
    media.rotate();
    // Two rotations later the first key is gone.
    expect(media.verifyUrl(before)).toEqual({ ok: false, reason: 'signature' });
    expect(media.verifyUrl(after)).toMatchObject({ ok: true });
    media.revokeAll();
    expect(media.verifyUrl(after)).toEqual({ ok: false, reason: 'signature' });
    expect(media.verifyUrl(media.signedUrl(meta, 'http://h'))).toMatchObject({ ok: true });
    // Trailing slashes on the origin are trimmed without a backtracking regex.
    expect(media.signedUrl(meta, 'http://h///')).toBe(media.signedUrl(meta, 'http://h'));
    expect(media.signedUrl(meta, `http://h${'/'.repeat(50_000)}x`).startsWith(`http://h${'/'.repeat(50_000)}x/`)).toBe(true);
  });

  it('keeps the key in .zhin/sandbox/media/secret with mode 0600', async () => {
    const { media, root } = await store();
    await put(media, PNG);
    media.signedUrl(media.list()[0]!, 'http://h');
    const file = join(root, '.zhin', 'sandbox', 'media', 'secret');
    const secret = JSON.parse(await readFile(file, 'utf8')) as { current: string };
    expect(Buffer.from(secret.current, 'base64url')).toHaveLength(32);
    if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('refuses expired links and sweeps expired objects; deleting revokes at once', async () => {
    const { media, clock } = await store({ ttlHours: 1 });
    const meta = await put(media, PNG);
    const url = media.signedUrl(meta, 'http://h');
    const kept = await put(media, PNG);
    const keptUrl = media.signedUrl(kept, 'http://h');
    expect(media.delete(kept.id)).toBe(true);
    expect(media.verifyUrl(keptUrl)).toEqual({ ok: false, reason: 'missing' });
    clock.now += 3_600_000;
    expect(media.verifyUrl(url)).toEqual({ ok: false, reason: 'expired' });
    expect(media.sweep()).toBe(1);
    expect(media.list()).toEqual([]);
  });

  it('binds an object to its conversation and uploader', async () => {
    const { media } = await store();
    const meta = await put(media, PNG);
    const url = media.signedUrl(meta, 'http://h');
    expect(meta.conversation).toEqual(room);
    expect(meta.uploader).toBe('user:alice');
    expect(media.authorize(url, { conversation: room, uploader: 'user:alice' })).toMatchObject({ ok: true });
    expect(media.authorize(url, { conversation: { ...room, id: 'room-2' } })).toEqual({ ok: false, reason: 'conversation_mismatch' });
    expect(media.authorize(url, { conversation: { ...room, type: 'private' } })).toEqual({ ok: false, reason: 'conversation_mismatch' });
    expect(media.authorize(url, { conversation: { ...room, endpoint: 'other-bot' } })).toEqual({ ok: false, reason: 'conversation_mismatch' });
    expect(media.authorize(url, { conversation: room, uploader: 'user:mallory' })).toEqual({ ok: false, reason: 'uploader_mismatch' });
    await expect(put(media, PNG, { conversation: { ...room, endpoint: 'other-bot' } })).rejects.toMatchObject({ code: 'invalid_conversation' });
  });

  it('counts quota per uploader and refuses over it without evicting anyone', async () => {
    const { media } = await store({ uploaderQuotaBytes: 30, quotaBytes: 50 });
    const a1 = await put(media, PNG, { uploader: 'user:alice' });
    const a2 = await put(media, PNG, { uploader: 'user:alice' });
    await expect(put(media, PNG, { uploader: 'user:alice' })).rejects.toMatchObject({ code: 'uploader_quota_exceeded', status: 507 });
    // Another uploader still has room; nothing of alice's was removed to make it.
    const b1 = await put(media, PNG, { uploader: 'user:bob' });
    const b2 = await put(media, PNG, { uploader: 'user:bob' });
    expect(media.list().map(meta => meta.id).sort()).toEqual([a1.id, a2.id, b1.id, b2.id].sort());
    // The endpoint total (48 of 50 bytes) refuses the next upload of anyone, again without eviction.
    await expect(put(media, PNG, { uploader: 'user:carol' })).rejects.toMatchObject({ code: 'quota_exceeded', status: 507 });
    expect(media.list()).toHaveLength(4);
    expect(media.usage('user:alice')).toBe(24);
  });

  it('bounds the number of objects per uploader and per endpoint, uploads in flight included', async () => {
    // Byte quotas alone let a stream of 1-byte uploads grow the index and the directory without bound.
    expect(SANDBOX_MEDIA_MAX_OBJECTS_PER_UPLOADER).toBeLessThan(SANDBOX_MEDIA_MAX_OBJECTS);
    const root = await mkdtemp(join(tmpdir(), 'zhin-sandbox-media-'));
    roots.push(root);
    const media = new SandboxMediaStore({ root: join(root, '.zhin', 'sandbox', 'media'), endpointId: 'bot',
      config: SANDBOX_MEDIA_DEFAULTS, now: () => 1_800_000_000_000, objectLimits: { uploader: 3, endpoint: 5 } });
    const one = new Uint8Array([1]);
    for (let i = 0; i < 3; i += 1) await put(media, one);
    await expect(put(media, one)).rejects.toMatchObject({ code: 'uploader_object_limit_exceeded', status: 507 });
    // Concurrent uploads count before they finish: two at once with room for one.
    await put(media, one, { uploader: 'user:bob' });
    const stalled = new TransformStream<Uint8Array, Uint8Array>();
    const pending = media.put({ body: stalled.readable, declaredLength: 1, conversation: room, uploader: 'user:bob' });
    await expect(put(media, one, { uploader: 'user:carol' })).rejects.toMatchObject({ code: 'object_limit_exceeded' });
    const writer = stalled.writable.getWriter();
    await writer.write(one);
    await writer.close();
    await pending;
    expect(media.objectCount()).toBe(5);
    // Deleting frees a slot; nothing is evicted to make one.
    media.delete(media.list()[0]!.id);
    await put(media, one, { uploader: 'user:carol' });
    expect(media.objectCount()).toBe(5);
  });

  it('limits size by type, before and while receiving', async () => {
    const { media } = await store({ maxBytes: { image: 16, audio: 64, video: 64, file: 8 } });
    await expect(put(media, new Uint8Array(17))).rejects.toMatchObject({ code: 'too_large', status: 413 });
    // A body longer than its Content-Length is cut off while it is received.
    await expect(media.put({ body: body(new Uint8Array(40)), declaredLength: 12, declaredType: 'audio/ogg', conversation: room, uploader: 'u' }))
      .rejects.toMatchObject({ code: 'length_mismatch', status: 400 });
    await expect(media.put({ body: body(PNG), declaredLength: 14, declaredType: 'image/png', conversation: room, uploader: 'u' }))
      .rejects.toMatchObject({ code: 'length_mismatch' });
    await expect(media.put({ body: body(PNG), declaredLength: undefined, conversation: room, uploader: 'u' }))
      .rejects.toMatchObject({ code: 'length_required', status: 411 });
    // Declared audio but the bytes are text: the sniffed kind's (smaller) limit applies.
    const text = new TextEncoder().encode('hello sandbox');
    await expect(media.put({ body: body(text), declaredLength: text.byteLength, declaredType: 'audio/ogg', conversation: room, uploader: 'u' }))
      .rejects.toMatchObject({ code: 'too_large' });
    expect(media.list()).toEqual([]);
  });

  it('sniffs the type from the bytes like the Agent does, and never serves SVG / HTML inline', async () => {
    const samples: Array<[string, Uint8Array]> = [
      ['png', PNG],
      ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])],
      ['gif', Buffer.from('GIF89a......')],
      ['webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')],
      ['wav', Buffer.from('RIFF\0\0\0\0WAVEfmt ')],
      ['ogg', Buffer.from('OggS\0\0\0\0')],
      ['mp3', Buffer.from('ID3\x03\0\0\0\0')],
      ['mp4', Buffer.from('\0\0\0\x18ftypmp42\0\0\0\0')],
      ['webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0])],
      ['pdf', Buffer.from('%PDF-1.7\n')],
      ['zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])],
      ['text', Buffer.from('plain words')],
    ];
    for (const [name, bytes] of samples) {
      const agent = inspectMediaBytes(Buffer.from(bytes));
      const sandbox = sniffSandboxMedia(bytes);
      expect({ kind: sandbox.kind, mime: sandbox.mime }, name).toEqual({ kind: agent!.kind, mime: agent!.mimeType });
    }
    expect(sniffSandboxMedia(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'))).toEqual({ kind: 'file', mime: 'image/svg+xml' });
    expect(sniffSandboxMedia(Buffer.from('<svg onload="alert(1)"></svg>'))).toEqual({ kind: 'file', mime: 'image/svg+xml' });
    expect(sniffSandboxMedia(Buffer.from('<!DOCTYPE html><html><script>x</script>'))).toEqual({ kind: 'file', mime: 'text/html' });
    expect(sniffSandboxMedia(Buffer.from([0, 1, 2, 3]))).toEqual({ kind: 'file', mime: 'application/octet-stream' });
    // Upper-case markup is refused just the same (CodeQL js/bad-tag-filter).
    expect(sniffSandboxMedia(Buffer.from('hello<SCRIPT>x</SCRIPT>'))).toEqual({ kind: 'file', mime: 'text/html' });
    expect(sniffSandboxMedia(Buffer.from('<SVG onload="alert(1)"></SVG>'))).toEqual({ kind: 'file', mime: 'image/svg+xml' });
    const { media } = await store();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const meta = await media.put({ body: body(svg), declaredLength: svg.byteLength, declaredType: 'image/svg+xml', conversation: room, uploader: 'u' });
    expect(meta).toMatchObject({ kind: 'file', mime: 'image/svg+xml', disposition: 'attachment' });
    // A declared type never wins over the bytes.
    const lied = await media.put({ body: body(PNG), declaredLength: PNG.byteLength, declaredType: 'text/html', conversation: room, uploader: 'u' });
    expect(lied).toMatchObject({ kind: 'image', mime: 'image/png', disposition: 'inline' });
  });

  it('survives a restart: metadata is read back from disk', async () => {
    const { media, root, clock } = await store();
    const meta = await put(media, PNG);
    const url = media.signedUrl(meta, 'http://h');
    const again = new SandboxMediaStore({ root: join(root, '.zhin', 'sandbox', 'media'), endpointId: 'bot', config: SANDBOX_MEDIA_DEFAULTS, now: () => clock.now });
    expect(again.verifyUrl(url)).toMatchObject({ ok: true, meta: { id: meta.id, sha256: meta.sha256 } });
  });
});

describe('Sandbox media config (ADR 0064 D12.2 / D12.3, revised)', () => {
  it('caps one file at the gateway request-body limit', () => {
    expect(SANDBOX_MEDIA_HARD_MAX_FILE_BYTES).toBe(DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES);
    for (const limit of Object.values(SANDBOX_MEDIA_DEFAULTS.maxBytes)) expect(limit).toBeLessThan(DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES);
    expect(() => resolveSandboxMediaConfig({ maxBytes: { video: DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES + 1 } })).toThrow(/must not exceed/u);
    expect(resolveSandboxMediaConfig({ maxBytes: { video: DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES } }).maxBytes.video).toBe(DEFAULT_GATEWAY_MAX_REQUEST_BODY_BYTES);
  });

  it('keeps public download off by default and bounds the link lifetime to 1–168 hours', () => {
    expect(resolveSandboxMediaConfig(undefined)).toMatchObject({ publicDownload: false, ttlHours: 24 });
    expect(resolveSandboxMediaConfig({ publicDownload: true }).publicDownload).toBe(true);
    expect(() => resolveSandboxMediaConfig({ ttlHours: 169 })).toThrow();
    expect(() => resolveSandboxMediaConfig({ ttlHours: 0 })).toThrow();
    expect(() => resolveSandboxMediaConfig({ uploaderQuotaBytes: 10, quotaBytes: 5 })).toThrow();
    expect(() => resolveSandboxMediaConfig({ quotaBytes: 6 * 1024 ** 3 })).toThrow();
  });

  it('reports refusals as typed errors', () => {
    expect(new SandboxMediaError('too_large', 413, 'x')).toMatchObject({ name: 'SandboxMediaError', code: 'too_large', status: 413 });
  });
});
