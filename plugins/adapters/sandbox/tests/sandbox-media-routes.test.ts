import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { createHttpHost } from '@zhin.js/host-http/node';
import type { ConsoleUserPrincipal } from '@zhin.js/host-http';
import { CONSOLE_BUILTIN_ROLES, resolveConsoleHttpPermission, type ConsoleBuiltinRoleName } from '../../../../packages/console/protocol/src/index.js';
import type { EndpointEvent } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEndpointEventGateway } from '../../test-utils/endpoint.js';
import { SandboxWsEndpoint } from '../src/endpoint.js';
import { resolveSandboxEndpoint, type SandboxEndpointConfig } from '../src/protocol.js';
import { sandboxInboundMediaSegment } from '../src/inbound-syntax.js';
import { parseSandboxMediaUrl } from '../src/media-url.js';
import { sandboxOperations } from './sandbox-operations.js';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  execFile: (_file: string, _args: readonly string[], _options: object,
    callback: (error: Error | null, stdout: string) => void) => queueMicrotask(() => callback(null, 'synthetic-version')),
}));

type Frame = Record<string, unknown>;
const hosts: ReturnType<typeof createHttpHost>[] = [];
const clients: WebSocket[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.terminate();
  await Promise.all(hosts.splice(0).map(host => host.close()));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function user(id: string, role: ConsoleBuiltinRoleName): ConsoleUserPrincipal {
  return Object.freeze({
    kind: 'user' as const, userId: id, username: id, displayName: id, credentialId: `${id}-session`,
    grants: Object.freeze([{ role, scope: { kind: 'global' as const }, permissions: CONSOLE_BUILTIN_ROLES[role].permissions }]),
    roles: Object.freeze([role]),
  });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

async function fixture(config: Partial<SandboxEndpointConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zhin-sandbox-routes-'));
  roots.push(root);
  const http = createHttpHost({ host: '127.0.0.1', port: 0 });
  hosts.push(http);
  const audits: unknown[] = [];
  const principals = new Map<string, ConsoleUserPrincipal>([
    ['owner-token', user('owner', 'owner')],
    ['alice-token', user('alice', 'operator')],
    ['bob-token', user('bob', 'operator')],
    ['viewer-token', user('viewer', 'viewer')],
  ]);
  http.tokenRegistry.useAccessProvider({
    initialized: () => true,
    authenticate: async token => principals.get(token) ?? null,
    audit: entry => { audits.push(entry); },
  });
  const receive = vi.fn(async (_input: unknown) => Object.freeze({ matched: true }));
  const events = vi.fn(async (event: EndpointEvent) => event.name === 'message.receive' ? receive(event.payload) : undefined);
  const endpoint = await createEndpointHarness(() => new SandboxWsEndpoint({
    id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'sandbox'),
    http, defaults: resolveSandboxEndpoint({ id: 'bot', owner: 'owner', ...config }),
    mediaRoot: join(root, '.zhin', 'sandbox', 'media'),
  }), { name: 'sandbox', capabilities: ['inbound', 'outbound'], operations: sandboxOperations, gateway: createTestEndpointEventGateway({ receive: events }) });
  await endpoint.start();
  endpoint.open();
  const { port } = await http.listen();
  const origin = `http://127.0.0.1:${port}`;
  const upload = (token: string, bytes: Uint8Array, options: { type?: string; scene?: string; name?: string; contentType?: string } = {}) =>
    fetch(`${origin}/api/sandbox/media/bot?type=${options.type ?? 'group'}&id=${options.scene ?? 'room-1'}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': options.contentType ?? 'image/png',
        ...(options.name ? { 'x-zhin-file-name': encodeURIComponent(options.name) } : {}) },
      body: bytes,
    });
  const connect = async (token: string) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/sandbox?token=${token}`);
    clients.push(client);
    const frames: Frame[] = [];
    client.on('message', data => frames.push(JSON.parse(String(data)) as Frame));
    await new Promise<void>((resolve, reject) => { client.once('open', resolve); client.once('error', reject); });
    await vi.waitFor(() => expect(frames.some(frame => frame.type === 'ready')).toBe(true));
    return { client, frames };
  };
  return { http, endpoint, origin, upload, connect, receive, audits };
}

describe('Sandbox media routes (ADR 0064 D12 / D13, I1)', () => {
  it('uploads raw bytes and replies with a signed link the page turns into a url segment', async () => {
    const { upload, origin } = await fixture();
    const response = await upload('alice-token', PNG, { name: '图 1.png', contentType: 'application/octet-stream' });
    expect(response.status).toBe(201);
    const { data } = await response.json() as { data: { id: string; kind: string; mime: string; size: number; name: string; url: string } };
    expect(data).toMatchObject({ kind: 'image', mime: 'image/png', size: PNG.byteLength, name: '图 1.png' });
    expect(data.url.startsWith(`${origin}/pub/sandbox-media/`)).toBe(true);
    expect(parseSandboxMediaUrl(data.url)?.id).toBe(data.id);
    expect(sandboxInboundMediaSegment('image', data.url, { mime_type: data.mime, size: data.size, file_name: data.name }))
      .toEqual({ type: 'image', data: { media: { kind: 'url', value: data.url, mime_type: 'image/png', size: PNG.byteLength, file_name: '图 1.png' } } });
  });

  it('registers every /api route it mounts in the Console permission map', async () => {
    const { http } = await fixture();
    const routes = http.listRoutes().filter(route => route.pattern.startsWith('/api/'));
    expect(routes.length).toBeGreaterThanOrEqual(4);
    for (const route of routes) {
      const relative = route.pattern.replace(/^\/api/u, '').replace(/\/\*$/u, '/x');
      expect(resolveConsoleHttpPermission(route.method, relative), `${route.method} ${route.pattern}`).not.toBeNull();
    }
    expect(resolveConsoleHttpPermission('POST', '/sandbox/media/bot')?.permission).toBe('endpoint.operate');
    expect(resolveConsoleHttpPermission('GET', '/sandbox/media/bot/x')?.permission).toBe('endpoint.view');
  });

  it('refuses an upload without endpoint.operate, and over the size and quota limits', async () => {
    const { upload } = await fixture({ media: { maxBytes: { image: 16 }, uploaderQuotaBytes: 24, quotaBytes: 40 } });
    expect((await upload('viewer-token', PNG)).status).toBe(403);
    expect((await upload('alice-token', new Uint8Array(20))).status).toBe(413);
    expect((await upload('alice-token', PNG)).status).toBe(201);
    expect((await upload('alice-token', PNG)).status).toBe(201);
    const over = await upload('alice-token', PNG);
    expect(over.status).toBe(507);
    expect(await over.json()).toMatchObject({ code: 'uploader_quota_exceeded' });
    // Bob's quota is his own; the endpoint total then refuses everyone.
    expect((await upload('bob-token', PNG)).status).toBe(201);
    expect(await (await upload('bob-token', PNG)).json()).toMatchObject({ code: 'quota_exceeded' });
    expect((await upload('alice-token', PNG, { name: '../x.png' })).status).toBe(400);
  });

  it('serves the Console download to endpoint.view in the same conversation only, 404 otherwise', async () => {
    const { upload, origin } = await fixture();
    const { data } = await (await upload('alice-token', PNG)).json() as { data: { id: string } };
    const get = (query: string, token = 'viewer-token') => fetch(`${origin}/api/sandbox/media/bot/${data.id}${query}`, { headers: { authorization: `Bearer ${token}` } });
    const ok = await get('?type=group&id=room-1');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-disposition')).toMatch(/^inline;/u);
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(PNG);
    expect((await get('?type=group&id=room-2')).status).toBe(404);
    expect((await get('?type=private&id=room-1')).status).toBe(404);
    expect((await get('')).status).toBe(404);
    expect((await fetch(`${origin}/api/sandbox/media/bot/${data.id}?type=group&id=room-1`)).status).toBe(401);
    expect((await fetch(`${origin}/api/sandbox/media/bot/..%2F..%2Fsecret?type=group&id=room-1`, { headers: { authorization: 'Bearer viewer-token' } })).status).toBe(404);
  });

  it('forces SVG and HTML to download with nosniff', async () => {
    const { upload, origin } = await fixture();
    for (const [source, mime] of [['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>', 'image/svg+xml'], ['<!doctype html><script>alert(1)</script>', 'text/html']] as const) {
      const response = await upload('alice-token', new TextEncoder().encode(source), { contentType: mime, name: 'x.svg' });
      const { data } = await response.json() as { data: { id: string; kind: string; mime: string } };
      expect(data).toMatchObject({ kind: 'file', mime });
      const served = await fetch(`${origin}/api/sandbox/media/bot/${data.id}?type=group&id=room-1`, { headers: { authorization: 'Bearer alice-token' } });
      expect(served.headers.get('content-disposition')).toMatch(/^attachment;/u);
      expect(served.headers.get('content-type')).toBe('application/octet-stream');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(served.headers.get('content-security-policy')).toContain('sandbox');
    }
  });

  it('keeps /pub/sandbox-media closed by default, even for a valid signature and a loopback peer', async () => {
    const { upload } = await fixture();
    const { data } = await (await upload('alice-token', PNG)).json() as { data: { url: string } };
    expect((await fetch(data.url)).status).toBe(404);
  });

  it('with publicDownload on, still requires a valid unexpired signature', async () => {
    const { upload, endpoint } = await fixture({ media: { publicDownload: true } });
    const { data } = await (await upload('alice-token', PNG)).json() as { data: { id: string; url: string } };
    const ok = await fetch(data.url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    const address = parseSandboxMediaUrl(data.url)!;
    const tampered = data.url.replace(address.sig, `${address.sig[0] === 'A' ? 'B' : 'A'}${address.sig.slice(1)}`);
    expect((await fetch(tampered)).status).toBe(404);
    expect((await fetch(data.url.replace(`exp=${address.exp}`, 'exp=1000'))).status).toBe(404);
    expect((await fetch(data.url.split('?')[0]!)).status).toBe(404);
    // Deleting revokes every link at once.
    expect(endpoint.endpoint.mediaStore.delete(data.id)).toBe(true);
    expect((await fetch(data.url)).status).toBe(404);
  });

  it('deletes only for the uploader or an owner; revoke-all is owner-only', async () => {
    const { upload, origin } = await fixture({ media: { publicDownload: true } });
    const { data } = await (await upload('alice-token', PNG)).json() as { data: { id: string; url: string } };
    const del = (token: string) => fetch(`${origin}/api/sandbox/media/bot/${data.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    expect((await del('bob-token')).status).toBe(403);
    expect((await del('viewer-token')).status).toBe(403);
    const secret = (token: string, action: string) => fetch(`${origin}/api/sandbox/media/bot/secret`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action }) });
    expect((await secret('alice-token', 'revoke-all')).status).toBe(403);
    expect((await fetch(data.url)).status).toBe(200);
    expect((await secret('owner-token', 'revoke-all')).status).toBe(200);
    expect((await fetch(data.url)).status).toBe(404);
    expect((await del('alice-token')).status).toBe(200);
    expect((await del('alice-token')).status).toBe(404);
  });

  it('refuses an inbound message carrying a hosted file from another conversation or uploader', async () => {
    const { upload, connect, receive } = await fixture();
    const { data } = await (await upload('alice-token', PNG)).json() as { data: { url: string; mime: string; size: number } };
    const segment = sandboxInboundMediaSegment('image', data.url, { mime_type: data.mime, size: data.size });
    const alice = await connect('alice-token');
    const send = (socket: WebSocket, scene: string, messageId: string) => socket.send(JSON.stringify({
      type: 'group', id: scene, messageId, senderId: 'alice', content: [segment], timestamp: Date.now() }));
    send(alice.client, 'room-2', 'm-other-room');
    await vi.waitFor(() => expect(alice.frames.some(frame => frame.code === 'sandbox_media_rejected' && frame.messageId === 'm-other-room')).toBe(true));
    const bob = await connect('bob-token');
    send(bob.client, 'room-1', 'm-other-uploader');
    await vi.waitFor(() => expect(bob.frames.some(frame => frame.code === 'sandbox_media_rejected' && frame.messageId === 'm-other-uploader')).toBe(true));
    const forged = sandboxInboundMediaSegment('image', data.url.replace(/sig=[^&]+/u, `sig=${'A'.repeat(43)}`));
    alice.client.send(JSON.stringify({ type: 'group', id: 'room-1', messageId: 'm-forged', content: [forged], timestamp: Date.now() }));
    await vi.waitFor(() => expect(alice.frames.some(frame => frame.code === 'sandbox_media_rejected' && frame.messageId === 'm-forged')).toBe(true));
    // Nested in a forward record it is still checked.
    alice.client.send(JSON.stringify({ type: 'group', id: 'room-2', messageId: 'm-nested',
      content: [{ type: 'forward', data: { forward_id: 'f', messages: [[segment]] } }], timestamp: Date.now() }));
    await vi.waitFor(() => expect(alice.frames.some(frame => frame.code === 'sandbox_media_rejected' && frame.messageId === 'm-nested')).toBe(true));
    expect(receive).not.toHaveBeenCalled();
    send(alice.client, 'room-1', 'm-ok');
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    const input = receive.mock.calls[0]![0] as { message: { segments?: unknown; id: string }; segments?: unknown };
    expect(JSON.stringify(input)).toContain(data.url);
  });

  it('refuses inbound media that names a host file, canonical or legacy, at any depth', async () => {
    const { upload, connect, receive, endpoint } = await fixture();
    const { data } = await (await upload('alice-token', PNG)).json() as { data: { id: string } };
    // The Agent's inbound media reads a `path` ref from disk without the file policy: this would
    // hand another conversation's upload (or `.zhin/sandbox/media/secret`) to the model.
    const hosted = join('.zhin', 'sandbox', 'media', endpoint.endpoint.mediaStore.dirKey, data.id);
    const bob = await connect('bob-token');
    const cases: Array<[string, unknown]> = [
      ['m-path', { type: 'image', data: { media: { kind: 'path', value: hosted } } }],
      ['m-secret', { type: 'file', data: { media: { kind: 'path', value: '.zhin/sandbox/media/secret' }, name: 'secret' } }],
      ['m-legacy-path', { type: 'image', data: { path: hosted } }],
      ['m-legacy-file', { type: 'file', data: { file: '/etc/passwd' } }],
      ['m-legacy-relative', { type: 'record', data: { file: './.zhin/sandbox/media/secret' } }],
      ['m-nested', { type: 'forward', data: { forward_id: 'f', messages: [[{ type: 'image', data: { file_path: hosted } }]] } }],
    ];
    for (const [messageId, segment] of cases) {
      bob.client.send(JSON.stringify({ type: 'group', id: 'room-1', messageId, content: [segment], timestamp: Date.now() }));
      await vi.waitFor(() => expect(bob.frames.some(frame => frame.code === 'sandbox_media_rejected' && frame.messageId === messageId), messageId).toBe(true));
    }
    expect(receive).not.toHaveBeenCalled();
    // A remote URL and a platform token are not host paths.
    bob.client.send(JSON.stringify({ type: 'group', id: 'room-1', messageId: 'm-remote',
      content: [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } }], timestamp: Date.now() }));
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
  });
});
