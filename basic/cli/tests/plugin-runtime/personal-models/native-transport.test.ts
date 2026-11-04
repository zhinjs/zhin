import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { createPersonalModelFetch } from '../../../src/plugin-runtime/personal-models/network.js';

vi.mock('node:https', () => ({ request: vi.fn() }));
vi.mock('@zhin.js/agent/security', async () => import('../../../../../packages/im/agent/src/security/network-policy.js'));

function fakeSocket(headers: Record<string, string> = {}) {
  const incoming = Object.assign(new PassThrough(), { headers, statusCode: 200, statusMessage: 'OK' });
  const outgoing = Object.assign(new EventEmitter(), { end: vi.fn() });
  let options: RequestOptions;
  vi.mocked(httpsRequest).mockImplementation((...args: unknown[]) => {
    options = args[0] as RequestOptions;
    const receive = args[1] as (response: IncomingMessage) => void;
    queueMicrotask(() => receive(incoming as unknown as IncomingMessage));
    return outgoing as unknown as ClientRequest;
  });
  return { incoming, outgoing, options: () => options };
}

describe('native personal model HTTPS transport', () => {
  it('opens only the vetted IP while preserving origin Host, certificate SNI and exact SDK body', async () => {
    const socket = fakeSocket({ 'content-type': 'text/event-stream' });
    const fetch = createPersonalModelFetch({ baseUrl: 'https://provider.example/v1',
      lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
    const response = await fetch('https://provider.example/v1/chat?stream=true', {
      method: 'POST', headers: { host: 'spoofed.example', authorization: 'Bearer synthetic-key' }, body: 'synthetic-body',
    });
    const options = socket.options();
    expect(options).toMatchObject({ hostname: '93.184.216.34', servername: 'provider.example', protocol: 'https:',
      method: 'POST', family: 4, agent: false, path: '/v1/chat?stream=true' });
    expect(options.headers).toMatchObject({ Host: 'provider.example', authorization: 'Bearer synthetic-key', 'accept-encoding': 'identity' });
    expect(options.headers).not.toHaveProperty('host');
    expect(socket.outgoing.end).toHaveBeenCalledWith(new TextEncoder().encode('synthetic-body'));
    const reader = response.body!.getReader();
    socket.incoming.write('data: first\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
    socket.incoming.end('data: last\n\n');
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: last\n\n');
  });

  it('decodes a compressed response incrementally instead of exposing gzip bytes to the SDK', async () => {
    const socket = fakeSocket({ 'content-encoding': 'gzip' });
    const fetch = createPersonalModelFetch({ baseUrl: 'https://provider.example',
      lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
    const response = await fetch('https://provider.example/v1');
    socket.incoming.end(gzipSync('synthetic-json-response'));
    expect(await response.text()).toBe('synthetic-json-response');
  });

  it('connects to a vetted IPv6 literal without introducing a different TLS servername', async () => {
    const socket = fakeSocket();
    const fetch = createPersonalModelFetch({ baseUrl: 'https://[2606:4700:4700::1111]' });
    const response = await fetch('https://[2606:4700:4700::1111]/v1');
    expect(socket.options()).toMatchObject({ hostname: '2606:4700:4700::1111', family: 6 });
    expect(socket.options()).not.toHaveProperty('servername');
    socket.incoming.end(); await response.text();
  });
});
