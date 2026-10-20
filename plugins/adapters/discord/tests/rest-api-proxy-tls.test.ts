import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiscordRestApiAgent } from '../src/rest-api-proxy.js';
import { defaultCreateClient } from '../src/gateway.js';
import type { Client } from 'discord.js';
import { Agent } from 'undici';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';
import { resolveDiscordConfig } from '../src/protocol.js';

const create = (agent: Agent, api?: string) => {
  const client = defaultCreateClient([], undefined, { agent, ...(api ? { api } : {}) }) as unknown as Client;
  client.rest.setToken('fixture-only'); return client;
};
const post = (client: Client) => client.rest.post('/channels/fixture/messages', { body: { content: 'fixture' } });
it('actual Discord SDK keeps TLS identity, has one POST after cut, and manual recovery works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-discord-api-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=discord.com', '-addext', 'subjectAltName=DNS:discord.com,IP:127.0.0.1'], { stdio: 'ignore' });
  const ca = readFileSync(join(dir, 'cert.pem'));
  let calls = 0; let cutting = true;
  const server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: ca }, (request, response) => {
    calls++; request.resume(); request.once('end', () => {
      if (cutting) { proxy.cut(); return; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ id: 'real-fixture-id' }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  const connect = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const agent = createDiscordRestApiAgent({ port: proxy.port });
  const client = create(agent);
  try {
    const error = await post(client).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(calls).toBe(1);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'discord.com', rejectUnauthorized: true }));
    cutting = false; proxy.recover(); await new Promise(resolve => setTimeout(resolve, 50)); expect(calls).toBe(1);
    await expect(post(client)).resolves.toMatchObject({ id: 'real-fixture-id' }); expect(calls).toBe(2);
    const before = connect.mock.calls.length;
    const mismatch = create(agent, 'https://unexpected.invalid/api');
    const mismatchError = await post(mismatch).catch(error => error);
    expect(mismatchError.message).toContain('rejected destination identity');
    await mismatch.destroy();
    expect(connect).toHaveBeenCalledTimes(before); expect(calls).toBe(2);
    // Default client has no fault agent: normal HTTPS with a fixture CA remains direct.
    const directAgent = new Agent({ connect: { ca } });
    try {
      const direct = create(directAgent, `https://127.0.0.1:${port}/api`);
      await expect(post(direct)).resolves.toMatchObject({ id: 'real-fixture-id' });
      expect(proxy.status().connections).toBe(2); expect(calls).toBe(3); await direct.destroy();
    } finally { await directAgent.destroy(); }
  } finally { await client.destroy(); await agent.destroyProxy(); connect.mockRestore(); await proxy.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});

it.each([0, -1, 65536, 1.5, '18400'])('rejects invalid dedicated Web API proxy port %j', port => {
  expect(() => resolveDiscordConfig({ id: 'fixture', token: 'fixture', restApiProxy: { port } as never })).toThrow('restApiProxy');
});
it('keeps default configuration direct and rejects unsupported interactions proxy mode', () => {
  expect(resolveDiscordConfig({ id: 'fixture', token: 'fixture' }).connection).toBe('gateway');
  expect(() => resolveDiscordConfig({ id: 'fixture', token: 'fixture', connection: 'interactions', restApiProxy: { port: 18400 } })).toThrow('gateway mode');
});

it('rejects a trusted-CA certificate whose SAN is not discord.com before sending HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-discord-api-san-'));
  const run = (args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
  run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'ca.key'), '-out', join(dir, 'ca.pem'), '-subj', '/CN=fixture-root', '-addext', 'basicConstraints=critical,CA:TRUE']);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'leaf.key'), '-out', join(dir, 'leaf.csr'), '-subj', '/CN=wrong.invalid']);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'extensions'), 'subjectAltName=DNS:wrong.invalid\nbasicConstraints=CA:FALSE\n');
  run(['x509', '-req', '-in', join(dir, 'leaf.csr'), '-CA', join(dir, 'ca.pem'), '-CAkey', join(dir, 'ca.key'), '-CAcreateserial', '-days', '1', '-out', join(dir, 'leaf.pem'), '-extfile', join(dir, 'extensions')]);
  let calls = 0;
  const server = https.createServer({ key: readFileSync(join(dir, 'leaf.key')), cert: readFileSync(join(dir, 'leaf.pem')) }, (_request, response) => { calls++; response.end('{}'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: (server.address() as { port: number }).port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  const connect = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca: readFileSync(join(dir, 'ca.pem')) }));
  const agent = createDiscordRestApiAgent({ port: proxy.port });
  const client = create(agent);
  try {
    const error = await post(client).catch(error => error);
    expect(error.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(calls).toBe(0);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ servername: 'discord.com', rejectUnauthorized: true }));
  } finally { await client.destroy(); await agent.destroyProxy(); connect.mockRestore(); await proxy.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});

it('cancels an in-flight TLS handshake when its dedicated agent is stopped', async () => {
  const { createServer } = await import('node:net');
  let accepted!: () => void; const connected = new Promise<void>(resolve => { accepted = resolve; });
  const peers: import('node:net').Socket[] = [];
  const server = createServer(socket => { peers.push(socket); socket.resume(); accepted(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const agent = createDiscordRestApiAgent({ port: (server.address() as { port: number }).port });
  const client = create(agent);
  try {
    const result = post(client).catch(error => error);
    await connected; const closed = once(peers[0]!, 'close'); await agent.destroyProxy(); await closed;
    const error = await result;
    expect(error.code).toBe('UND_ERR_DESTROYED');
    expect(agent.destroyed).toBe(true);
  } finally { await client.destroy(); await agent.destroyProxy(); peers.forEach(socket => socket.destroy()); await new Promise<void>(resolve => server.close(() => resolve())); }
});
