import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseStartOptions } from '@zhin.js/runtime';
import { runGateway } from '../../src/http/run-gateway.js';

const fixture = fileURLToPath(new URL('./fixtures/gateway-instance.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../../../node_modules/tsx/dist/esm/index.mjs', import.meta.url));
const dirs: string[] = [];
const savedNodeOptions = process.env.NODE_OPTIONS;

afterEach(async () => {
  if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = savedNodeOptions;
  delete process.env.FAKE_OWNER;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function until<T>(probe: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch { /* not up yet */ }
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function start(owner: boolean): Promise<{ origin: string; exit: Promise<number> }> {
  const root = await mkdtemp(join(tmpdir(), 'zhin-run-gateway-'));
  dirs.push(root);
  const port = await freePort();
  await writeFile(join(root, 'zhin.config.yml'), `http:\n  host: 127.0.0.1\n  port: ${port}\n`);
  // The supervised child resolves workspace sources and runs TypeScript like `pnpm dev` does.
  process.env.NODE_OPTIONS = `--conditions=development --import=${tsx}`;
  if (owner) process.env.FAKE_OWNER = '1';
  const args = ['runtime', 'start', '--once'];
  const exit = runGateway({ root, options: parseStartOptions(args.slice(2)), entry: fixture, args });
  return { origin: `http://127.0.0.1:${port}`, exit };
}

describe('runGateway (zhin runtime start, supervised)', () => {
  it('answers instance routes on the http port and forwards an open (pre-setup) principal', async () => {
    const { origin, exit } = await start(false);
    const hello = await until(async () => {
      const response = await fetch(`${origin}/hello`);
      return response.status === 200 ? response.json() as Promise<{ hello: string; origin: string }> : undefined;
    });
    expect(hello.hello).toBe('instance');
    // The gateway told the instance where it listens (HttpHost.address).
    expect(hello.origin).toBe(origin);
    const health = await (await fetch(`${origin}/pub/health`)).json() as { instance: { state: string; ready: boolean } };
    expect(health.instance).toEqual({ state: 'running', ready: true });

    // No owner, no http.token: the gateway forwards { kind: 'bootstrap', open: true } (B1.2 contract).
    const rpc = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'system:status', requestId: 'r1', data: { a: 1 } }),
    });
    expect(rpc.status).toBe(200);
    expect(await rpc.json()).toMatchObject({
      forwarded: { type: 'system:status', requestId: 'r1', data: { a: 1 } },
      principal: { kind: 'bootstrap', open: true },
    });
    // gateway.* RPC is answered by the gateway itself.
    const status = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'gateway.instance.status', requestId: 'r2' }),
    });
    expect(await status.json()).toMatchObject({ success: true, type: 'gateway.instance.status', requestId: 'r2', data: { instanceId: 'default', state: 'running' } });

    expect((await fetch(`${origin}/exit`, { method: 'POST' })).status).toBe(202);
    expect(await exit).toBe(0);
    // The gateway closed its listener with the run.
    await expect(fetch(`${origin}/pub/health`)).rejects.toThrow();
  }, 60_000);

  it('authenticates accounts through the instance once an owner exists', async () => {
    const { origin, exit } = await start(true);
    await until(async () => ((await fetch(`${origin}/hello`)).status === 200 ? true : undefined));
    const body = JSON.stringify({ type: 'system:status', requestId: 'r1' });
    const headers = { 'content-type': 'application/json' };
    // The instance reported an owner: no open Host any more.
    await until(async () => ((await fetch(`${origin}/api/console/request`, { method: 'POST', headers, body })).status === 401 ? true : undefined));
    const rejected = await fetch(`${origin}/api/console/request`, { method: 'POST', headers: { ...headers, authorization: 'Bearer wrong' }, body });
    expect(rejected.status).toBe(401);
    const accepted = await fetch(`${origin}/api/console/request`, { method: 'POST', headers: { ...headers, authorization: 'Bearer owner-token' }, body });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ principal: { kind: 'user', userId: 'u1', roles: ['owner'] } });
    // gateway.* payloads travel under `data`.
    const invalid = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer owner-token' },
      body: JSON.stringify({ type: 'gateway.instance.logs', data: { lines: 0 } }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ success: false, code: 'invalid_input' });
    // A denial at the gateway is audited in the instance's audit log.
    const denied = await fetch(`${origin}/api/console/request`, {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer nobody-token' },
      body: JSON.stringify({ type: 'gateway.instance.restart' }),
    });
    expect(denied.status).toBe(403);
    const audited = await until(async () => {
      const response = await fetch(`${origin}/api/console/request`, { method: 'POST', headers: { ...headers, authorization: 'Bearer owner-token' }, body });
      const { audits } = await response.json() as { audits: Array<{ action: string; outcome: string; actor: string }> };
      return audits.length > 0 ? audits : undefined;
    });
    expect(audited).toContainEqual(expect.objectContaining({ actor: 'user:u2', action: 'rpc:gateway.instance.restart', outcome: 'denied' }));

    expect((await fetch(`${origin}/exit`, { method: 'POST' })).status).toBe(202);
    expect(await exit).toBe(0);
  }, 60_000);
});
