import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isLoopbackHost, jsonResponse, TokenRegistry } from '@zhin.js/host-http';
import { assertNotOpenOnNetwork, loadGatewayHttpConfig, loadGatewaySettings, OpenHostOnNetworkError, startGateway, type RunningGateway } from '../../src/http/start-gateway.js';
import { EMPTY_ROUTE_TABLE, type InstanceTransport } from '@zhin.js/host-http/bridge';

const fixture = fileURLToPath(new URL('../supervisor/fixtures/fake-instance.mjs', import.meta.url));
const gateways: RunningGateway[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(config: string, env = ''): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zhin-gateway-'));
  dirs.push(dir);
  await writeFile(join(dir, 'zhin.config.yml'), config);
  if (env) await writeFile(join(dir, '.env.development'), env);
  return dir;
}

describe('loadGatewaySettings', () => {
  it('reads gateway.readyTimeout in seconds and ignores invalid values', async () => {
    expect(await loadGatewaySettings(await project('gateway:\n  readyTimeout: 180\n'))).toEqual({ readyTimeoutMs: 180_000 });
    expect(await loadGatewaySettings(await project('http:\n  port: 0\n'))).toEqual({});
    expect(await loadGatewaySettings(await project('gateway:\n  readyTimeout: 0\n'))).toEqual({});
    expect(await loadGatewaySettings(await project('gateway:\n  readyTimeout: "90"\n'))).toEqual({});
  });
});

describe('open Host on a network address (ADR 0049 §1)', () => {
  it('refuses to start open on a non-loopback http.host, with the HTTP_TOKEN / console init hint', () => {
    const open = new TokenRegistry();
    for (const host of ['0.0.0.0', '::', '192.168.1.5', 'bot.example.com']) {
      expect(() => assertNotOpenOnNetwork({ host }, open), host).toThrow(OpenHostOnNetworkError);
    }
    expect(() => assertNotOpenOnNetwork({ host: '0.0.0.0' }, open)).toThrow(/HTTP_TOKEN.*zhin console init/su);
    for (const host of [undefined, '127.0.0.1', 'localhost', '::1', '[::1]']) {
      expect(() => assertNotOpenOnNetwork(host === undefined ? {} : { host }, open), String(host)).not.toThrow();
    }
    // A bootstrap token (or a finished setup) closes the Host: any bind address is fine.
    expect(() => assertNotOpenOnNetwork({ host: '0.0.0.0' }, new TokenRegistry({ primaryToken: 'boot' }))).not.toThrow();
    expect(isLoopbackHost('127.10.0.1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
  });

  it('fails startGateway before listening', async () => {
    const root = await project('http:\n  host: 0.0.0.0\n  port: 0\n');
    await expect(startGateway({
      projectRoot: root,
      console: false,
      startInstance: false,
      supervisor: { spawn: { command: process.execPath, args: [fixture], cwd: root, env: process.env } },
      transport: () => ({
        ready: false,
        routes: () => EMPTY_ROUTE_TABLE,
        onRoutes: () => () => undefined,
        fetch: async () => new Response('never'),
        openWebSocket: async () => false,
      }),
    })).rejects.toBeInstanceOf(OpenHostOnNetworkError);
  });
});

describe('startGateway', () => {
  it('reads http.* (with .env placeholders and extra listeners) from the project config', async () => {
    const root = await project('http:\n  host: 127.0.0.1\n  port: ${GW_PORT}\n  base: /console-api\n  listeners:\n    - host: 127.0.0.1\n      port: 0\n', 'GW_PORT=0\n');
    const http = await loadGatewayHttpConfig(root);
    expect(http).toMatchObject({ host: '127.0.0.1', apiBase: '/console-api', listeners: [{ host: '127.0.0.1', port: 0 }] });
  });

  it('listens before the instance is ready and forwards once the transport is ready', async () => {
    const root = await project('http:\n  host: 127.0.0.1\n  port: 0\n');
    let disposed = false;
    const gateway = await startGateway({
      projectRoot: root,
      supervisor: {
        spawn: { command: process.execPath, args: [fixture], cwd: root, env: { ...process.env, FAKE_READY_DELAY_MS: '200' } },
        readyTimeoutMs: 5_000,
        shutdownBudgetMs: 300,
        killGraceMs: 300,
      },
      transport: ({ supervisor }) => {
        const transport: InstanceTransport & { dispose(): void } = {
          get ready() { return supervisor.state === 'running'; },
          routes: () => EMPTY_ROUTE_TABLE,
          onRoutes: () => () => undefined,
          fetch: async (request) => jsonResponse(200, { forwarded: new URL(request.url).pathname }),
          openWebSocket: async () => false,
          dispose: () => { disposed = true; },
        };
        return transport;
      },
    });
    gateways.push(gateway);
    const origin = gateway.http.address!.origin;
    const early = await fetch(`${origin}/webhook`);
    expect(early.status).toBe(503);
    expect(await early.json()).toMatchObject({ code: 'instance_unavailable', state: 'starting' });

    await gateway.instanceStarted;
    expect(gateway.supervisor.state).toBe('running');
    expect(await (await fetch(`${origin}/webhook`)).json()).toEqual({ forwarded: '/webhook' });

    await gateway.close();
    expect(disposed).toBe(true);
    expect(gateway.supervisor.state).toBe('stopped');
  });

  it('keeps the gateway up when the instance fails to start', async () => {
    const root = await project('http:\n  host: 127.0.0.1\n  port: 0\n');
    const gateway = await startGateway({
      projectRoot: root,
      supervisor: {
        spawn: { command: process.execPath, args: [fixture], cwd: root, env: { ...process.env, FAKE_NO_READY: '1' } },
        readyTimeoutMs: 200,
        shutdownBudgetMs: 100,
        killGraceMs: 100,
        restart: { onCrash: false },
      },
      transport: ({ supervisor }) => ({
        get ready() { return supervisor.state === 'running'; },
        routes: () => EMPTY_ROUTE_TABLE,
        onRoutes: () => () => undefined,
        fetch: async () => new Response('never'),
        openWebSocket: async () => false,
      }),
    });
    gateways.push(gateway);
    await gateway.instanceStarted;
    const health = await fetch(`${gateway.http.address!.origin}/pub/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ instance: { ready: false } });
  });

  it('re-reads gateway.readyTimeout before every instance start and restart', async () => {
    const root = await project('http:\n  host: 127.0.0.1\n  port: 0\n');
    let configured: number | undefined = 7_000;
    const gateway = await startGateway({
      projectRoot: root,
      console: false,
      settings: async () => (configured === undefined ? {} : { readyTimeoutMs: configured }),
      supervisor: {
        spawn: { command: process.execPath, args: [fixture], cwd: root, env: process.env },
        readyTimeoutMs: 5_000,
        shutdownBudgetMs: 300,
        killGraceMs: 300,
      },
      transport: ({ supervisor }) => ({
        get ready() { return supervisor.state === 'running'; },
        routes: () => EMPTY_ROUTE_TABLE,
        onRoutes: () => () => undefined,
        fetch: async () => new Response('x'),
        openWebSocket: async () => false,
      }),
    });
    gateways.push(gateway);
    await gateway.instanceStarted;
    expect(gateway.supervisor.readyTimeoutMs).toBe(7_000);
    configured = 9_000;
    await gateway.rpc({ type: 'gateway.instance.restart' }, 'local');
    expect(gateway.supervisor.readyTimeoutMs).toBe(9_000);
    // Removing the setting goes back to the supervisor's own value.
    configured = undefined;
    await gateway.rpc({ type: 'gateway.instance.stop' }, 'local');
    await gateway.rpc({ type: 'gateway.instance.start' }, 'local');
    expect(gateway.supervisor.readyTimeoutMs).toBe(5_000);
  }, 30_000);
});
