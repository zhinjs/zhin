import https from 'node:https';
import tls from 'node:tls';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSlackWebApiAgent } from '../src/web-api-proxy.js';
import { createSlackWebClient, slackDeliveryError } from '../src/web-client.js';
import { createTcpFaultProxy } from '../../../../scripts/platform-acceptance/tcp-fault-proxy.mjs';
import { resolveSlackConfig } from '../src/protocol.js';

const logger = { debug() {}, info() {}, warn() {}, error() {}, setLevel() {}, getLevel() { return 'error'; }, setName() {} };
it('actual Slack SDK keeps TLS identity, has one POST after cut, and manual recovery works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-slack-api-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-subj', '/CN=slack.com', '-addext', 'subjectAltName=DNS:slack.com,IP:127.0.0.1'], { stdio: 'ignore' });
  const ca = readFileSync(join(dir, 'cert.pem'));
  let calls = 0; let cutting = true;
  const server = https.createServer({ key: readFileSync(join(dir, 'key.pem')), cert: ca }, (request, response) => {
    calls++; request.resume(); request.once('end', () => {
      if (cutting) { proxy.cut(); return; }
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, ts: 'real-fixture-ts' }));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const proxy = await createTcpFaultProxy({ upstreamHost: '127.0.0.1', upstreamPort: port, port: 0, controlPort: 0 });
  const original = tls.connect.bind(tls);
  const connect = vi.spyOn(tls, 'connect').mockImplementation(options => original({ ...options as tls.ConnectionOptions, ca }));
  const agent = createSlackWebApiAgent({ port: proxy.port });
  const client = createSlackWebClient('fixture-only', { agent, logger: logger as never });
  try {
    const error = await client.chat.postMessage({ channel: 'fixture', text: 'fixture' }).catch(error => error);
    expect(slackDeliveryError(error)).toMatchObject({ disposition: 'unknown' });
    expect(calls).toBe(1);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', port: proxy.port, servername: 'slack.com', rejectUnauthorized: true, path: undefined }));
    cutting = false; proxy.recover(); await new Promise(resolve => setTimeout(resolve, 50)); expect(calls).toBe(1);
    await expect(client.chat.postMessage({ channel: 'fixture', text: 'new-sample' })).resolves.toMatchObject({ ts: 'real-fixture-ts' }); expect(calls).toBe(2);
    const before = connect.mock.calls.length;
    const mismatch = createSlackWebClient('fixture-only', { agent, slackApiUrl: 'https://unexpected.invalid/api/', logger: logger as never });
    await expect(mismatch.chat.postMessage({ channel: 'fixture', text: 'fixture' })).rejects.toThrow('rejected destination identity');
    expect(connect).toHaveBeenCalledTimes(before); expect(calls).toBe(2);
    // Default client has no fault agent: normal HTTPS with a fixture CA remains direct.
    const directAgent = new https.Agent({ ca });
    try {
      const direct = createSlackWebClient('fixture-only', { agent: directAgent, slackApiUrl: `https://127.0.0.1:${port}/api/`, logger: logger as never });
      await expect(direct.chat.postMessage({ channel: 'fixture', text: 'direct' })).resolves.toMatchObject({ ts: 'real-fixture-ts' });
      expect(proxy.status().connections).toBe(2); expect(calls).toBe(3);
    } finally { directAgent.destroy(); }
  } finally { agent.destroy(); connect.mockRestore(); await proxy.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});

it.each([0, -1, 65536, 1.5, '18400'])('rejects invalid dedicated Web API proxy port %j', port => {
  expect(() => resolveSlackConfig({ id: 'fixture', token: 'fixture', appToken: 'fixture', webApiProxy: { port } as never })).toThrow('webApiProxy');
});
it('keeps normal config direct and API proxy independent of Socket proxy', () => {
  const base = { id: 'fixture', token: 'fixture', appToken: 'fixture' };
  expect(resolveSlackConfig(base).webApiProxy).toBeUndefined();
  expect(resolveSlackConfig({ ...base, webApiProxy: { port: 18400 }, streamProxy: { port: 18401, serverName: 'wss-primary.slack.com' } })).toMatchObject({ webApiProxy: { port: 18400 }, streamProxy: { port: 18401 } });
});

it('rejects a trusted-CA certificate whose SAN is not slack.com before sending HTTP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhin-slack-api-san-'));
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
  const agent = createSlackWebApiAgent({ port: proxy.port });
  try {
    const client = createSlackWebClient('fixture-only', { agent, logger: logger as never });
    await expect(client.chat.postMessage({ channel: 'fixture', text: 'fixture' })).rejects.toThrow(/Hostname\/IP does not match certificate/);
    expect(calls).toBe(0);
    expect(connect).toHaveBeenCalledWith(expect.objectContaining({ servername: 'slack.com', rejectUnauthorized: true }));
  } finally { agent.destroy(); connect.mockRestore(); await proxy.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); }
});
