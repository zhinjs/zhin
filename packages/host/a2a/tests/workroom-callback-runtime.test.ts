import { afterEach, describe, expect, it, vi } from 'vitest';
import { request as sendHttpRequest } from 'node:http';
import { createHttpHost } from '@zhin.js/host-http';
import { WorkroomA2aAuthenticationError } from '../src/workroom-auth-registry.js';
import {
  installRuntimeWorkroomCallbacks,
  type RuntimeWorkroomCallbackDependencies,
} from '../src/workroom-callback-runtime.js';

const hosts: Array<ReturnType<typeof createHttpHost>> = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.close()));
});

describe('Runtime Workroom Callback Host', () => {
  it('mounts one dedicated authenticated callback route outside ordinary A2A inbound', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const handle = vi.fn(async (request: { credential: string; body: Uint8Array }) => {
      expect(request.credential).toBe('callback-secret');
      expect(new TextDecoder().decode(request.body)).toBe('{"version":1}');
      return {
        duplicate: false,
        projection: { status: 'open' },
        application: { status: 'applied' },
      } as never;
    });
    const dependencies = callbackDependencies({ handle });

    const installed = await installRuntimeWorkroomCallbacks({
      http,
      path: '/workroom-a2a/callback',
      dependencies,
      maxBodyBytes: 1_024,
    });
    const { port } = await http.listen();

    const ordinary = await fetch(`http://127.0.0.1:${port}/a2a/zhin/jsonrpc`, {
      method: 'POST',
      headers: { authorization: 'Bearer callback-secret' },
      body: '{"version":1}',
    });
    expect(ordinary.status).toBe(404);
    expect(handle).not.toHaveBeenCalled();

    const callback = await fetch(`http://127.0.0.1:${port}/workroom-a2a/callback`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer callback-secret',
        'content-type': 'application/json',
      },
      body: '{"version":1}',
    });
    expect(callback.status).toBe(202);
    expect(await callback.json()).toEqual({
      accepted: true,
      duplicate: false,
      applicationStatus: 'applied',
    });
    expect(handle).toHaveBeenCalledTimes(1);
    installed.dispose();
  });

  it('fails authentication before accepting a callback body', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const handle = vi.fn();
    await installRuntimeWorkroomCallbacks({
      http,
      path: '/workroom-a2a/callback',
      dependencies: callbackDependencies({
        authenticate: () => { throw new WorkroomA2aAuthenticationError(); },
        handle,
      }),
      maxBodyBytes: 64,
    });
    const { port } = await http.listen();

    const response = await fetch(`http://127.0.0.1:${port}/workroom-a2a/callback`, {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
      body: '{"version":1}',
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(handle).not.toHaveBeenCalled();
  });

  it('returns 413 on the first over-limit chunk without waiting for request EOF', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const handle = vi.fn();
    await installRuntimeWorkroomCallbacks({
      http,
      path: '/workroom-a2a/callback',
      dependencies: callbackDependencies({ handle }),
      maxBodyBytes: 8,
    });
    const { port } = await http.listen();

    const response = new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = sendHttpRequest({
        host: '127.0.0.1',
        port,
        path: '/workroom-a2a/callback',
        method: 'POST',
        headers: {
          authorization: 'Bearer callback-secret',
          'transfer-encoding': 'chunked',
        },
      }, incoming => {
        const chunks: Buffer[] = [];
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)));
        incoming.on('end', () => resolve({
          status: incoming.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      request.once('error', reject);
      request.write('123456789');
      // Deliberately never call end(): the Host must reject the first
      // over-limit chunk rather than holding the worker until attacker EOF.
    });

    await expect(response).resolves.toEqual({
      status: 413,
      body: JSON.stringify({ error: 'Callback body exceeds 8 bytes' }),
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('enumerates every durable Link and runs recovery before publishing the route', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const events: string[] = [];
    const dependencies = callbackDependencies({
      listRegistered: async () => {
        events.push('list');
        return [{ id: 'link-b' }, { id: 'link-a' }] as never;
      },
      runOnce: async (linkId) => {
        events.push(`recover:${linkId}`);
        return { status: 'noop', reason: 'inbox_not_registered' };
      },
    });

    const installed = await installRuntimeWorkroomCallbacks({
      http,
      path: '/workroom-a2a/callback',
      dependencies,
      maxBodyBytes: 1_024,
    });

    expect(events).toEqual(['list', 'recover:link-a', 'recover:link-b']);
    expect(installed.recovery).toEqual({ registered: 2, recovered: 2, failed: 0 });
    expect(http.listRoutes().some(route => route.pattern === '/workroom-a2a/callback')).toBe(true);
  });

  it('keeps a failed recovery durable and available instead of blocking callback ingress', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const onRecoveryError = vi.fn();
    const dependencies = callbackDependencies({
      listRegistered: async () => [{ id: 'gap-link' }] as never,
      runOnce: async () => { throw new Error('poll unavailable'); },
    });

    const installed = await installRuntimeWorkroomCallbacks({
      http,
      path: '/workroom-a2a/callback',
      dependencies,
      maxBodyBytes: 1_024,
      onRecoveryError,
    });

    expect(installed.recovery).toEqual({ registered: 1, recovered: 0, failed: 1 });
    expect(onRecoveryError).toHaveBeenCalledWith('gap-link', expect.any(Error));
    expect(http.listRoutes().some(route => route.pattern === '/workroom-a2a/callback')).toBe(true);
  });

  it('can defer recovery until the composition root has activated durable Workroom state', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const events: string[] = [];
    const installed = await installRuntimeWorkroomCallbacks({
      http,
      path: '/workroom-a2a/callback',
      dependencies: callbackDependencies({
        listRegistered: async () => {
          events.push('list');
          return [{ id: 'link-1' }] as never;
        },
        runOnce: async linkId => {
          events.push(`recover:${linkId}`);
          return { status: 'noop', reason: 'inbox_not_registered' };
        },
      }),
      maxBodyBytes: 1_024,
      deferRecovery: true,
    });

    expect(events).toEqual([]);
    expect(installed.recovery).toBeUndefined();
    expect(await installed.recover()).toEqual({ registered: 1, recovered: 1, failed: 0 });
    expect(events).toEqual(['list', 'recover:link-1']);
  });

  it('rejects a callback path nested under the configured ordinary A2A route', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);

    await expect(installRuntimeWorkroomCallbacks({
      http,
      path: '/mesh/workroom-callback',
      ordinaryA2aBasePath: '/mesh',
      dependencies: callbackDependencies(),
      maxBodyBytes: 1_024,
    })).rejects.toThrow('outside ordinary A2A inbound');
    expect(http.listRoutes().some(route => route.pattern === '/mesh/workroom-callback')).toBe(false);
  });

  it('normalizes a long trailing slash run in linear time', async () => {
    const http = createHttpHost({ host: '127.0.0.1', port: 0 });
    hosts.push(http);
    const trailing = '/'.repeat(20_000);

    const installed = await installRuntimeWorkroomCallbacks({
      http,
      path: `/workroom-a2a/callback${trailing}`,
      dependencies: callbackDependencies(),
      maxBodyBytes: 1_024,
    });

    expect(http.listRoutes().some(route => route.pattern === '/workroom-a2a/callback')).toBe(true);
    installed.dispose();
  });
});

interface CallbackDependencyOverrides {
  readonly authenticate?: RuntimeWorkroomCallbackDependencies['authRegistry']['authenticate'];
  readonly handle?: RuntimeWorkroomCallbackDependencies['gateway']['handle'];
  readonly listRegistered?: RuntimeWorkroomCallbackDependencies['linkRegistry']['listRegistered'];
  readonly runOnce?: RuntimeWorkroomCallbackDependencies['application']['runOnce'];
}

function callbackDependencies(overrides: CallbackDependencyOverrides = {}): RuntimeWorkroomCallbackDependencies {
  return {
    authRegistry: {
      authenticate: overrides.authenticate ?? (() => ({ endpointId: 'endpoint-1' }) as never),
    },
    gateway: {
      handle: overrides.handle ?? (async () => ({
        duplicate: false,
        projection: { status: 'open' },
        application: { status: 'noop', reason: 'inbox_not_registered' },
      }) as never),
    },
    linkRegistry: {
      listRegistered: overrides.listRegistered ?? (async () => []),
    },
    application: {
      runOnce: overrides.runOnce
        ?? (async () => ({ status: 'noop', reason: 'inbox_not_registered' })),
    },
  };
}
