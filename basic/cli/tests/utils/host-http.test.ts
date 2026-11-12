import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectableHost, hostGet, listHostEndpoints, loadHostHttpConfig } from '../../src/utils/host-http.js';
import { LOCAL_GATEWAY_RPC, LocalControlServer } from '@zhin.js/gateway/local';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hostGet', () => {
  it('passes a 5s AbortSignal timeout to fetch', async () => {
    let observed: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      observed = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { ok: 1 } }),
      } as Response;
    }));

    const result = await hostGet({ baseUrl: 'http://127.0.0.1:8086/api', token: '' }, '/stats');
    expect(result.ok).toBe(true);
    expect(observed?.signal).toBeInstanceOf(AbortSignal);
    expect((observed?.signal as AbortSignal).aborted).toBe(false);
  });

  it('maps an abort timeout to a friendly error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' });
    }));

    const result = await hostGet({ baseUrl: 'http://127.0.0.1:8086/api', token: '' }, '/stats');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain('超时');
    expect(result.error).toContain('http://127.0.0.1:8086/api');
  });

  it('maps Node fetch connection refusal causes to the runtime-start hint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      });
    }));

    const result = await hostGet({ baseUrl: 'http://127.0.0.1:8086/api', token: 'token' }, '/stats');

    expect(result).toEqual({
      ok: false,
      status: 0,
      error: '无法连接 http://127.0.0.1:8086/api（请先 zhin start）',
    });
  });
});

describe('connectableHost', () => {
  it.each([
    ['0.0.0.0', '127.0.0.1'], ['::', '[::1]'], ['[::]', '[::1]'], ['::1', '[::1]'], ['[::1]', '[::1]'],
    ['127.0.0.1', '127.0.0.1'], ['localhost', 'localhost'], ['bot.example.com', 'bot.example.com'],
  ])('maps the bind address %s to the connectable host %s', (bind, host) => {
    expect(connectableHost(bind)).toBe(host);
  });
});

describe('listHostEndpoints', () => {
  it('pages through /introspection/endpoints and reads data.items', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      const page = Number(new URL(url).searchParams.get('page'));
      const items = page === 1
        ? [{ name: 'a', adapter: 'icqq', online: true, status: 'online' }, { adapter: 'broken' }]
        : [{ name: 'b', adapter: 'discord', online: false, status: 'offline' }];
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { items, page, pageSize: 100, total: 3, totalPages: 2 } }),
      } as Response;
    }));

    const result = await listHostEndpoints({ baseUrl: 'http://127.0.0.1:8086/api', token: 't' });

    expect(result.data).toEqual([
      { name: 'a', adapter: 'icqq', status: 'online' },
      { name: 'b', adapter: 'discord', status: 'offline' },
    ]);
    expect(urls).toEqual([
      'http://127.0.0.1:8086/api/introspection/endpoints?page=1&pageSize=100',
      'http://127.0.0.1:8086/api/introspection/endpoints?page=2&pageSize=100',
    ]);
  });

  it('propagates a failed page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 401, json: async () => ({ success: false, error: 'Unauthorized' }),
    } as Response)));
    const failed = await listHostEndpoints({ baseUrl: 'http://127.0.0.1:8086/api', token: '' });
    expect(failed).toMatchObject({ ok: false, status: 401 });
    // A 401 over HTTP explains the ADR 0049 token rules.
    expect(failed.error).toMatch(/^Unauthorized（.*ZHIN_CONSOLE_TOKEN.*zhin start/u);
  });
});

describe('loadHostHttpConfig', () => {
  let dir: string;
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns null without a Root config file', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    expect(await loadHostHttpConfig(dir)).toBeNull();
  });

  it('resolves the token through .env and lets .env.<environment> override it', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'),
      'http:\n  host: 0.0.0.0\n  port: 9100\n  base: /admin/\n  token: ${ZHIN_TEST_HOST_HTTP_TOKEN}\n');
    fs.writeFileSync(path.join(dir, '.env'), 'ZHIN_TEST_HOST_HTTP_TOKEN="base-token"\n');
    expect(await loadHostHttpConfig(dir, 'development'))
      .toEqual({ baseUrl: 'http://127.0.0.1:9100/admin', token: 'base-token' });

    fs.writeFileSync(path.join(dir, '.env.production'), 'ZHIN_TEST_HOST_HTTP_TOKEN=prod-token\n');
    expect((await loadHostHttpConfig(dir, 'production'))?.token).toBe('prod-token');
    expect((await loadHostHttpConfig(dir, 'development'))?.token).toBe('base-token');
  });

  it.runIf(process.platform !== 'win32')('uses the local control socket while a gateway runs (no token needed)', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhh-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'), 'http:\n  port: 9100\n');
    const control = await LocalControlServer.open({ path: path.join(dir, '.zhin', 'gateway.sock') });
    const seen: unknown[] = [];
    control.setHandler(async (request) => {
      if (request.type === LOCAL_GATEWAY_RPC.INFO) return { ok: true, data: { gateway: {}, instance: {}, consoleInitialized: true } };
      seen.push(request);
      return { ok: true, data: { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, data: { jobs: [] } }) } };
    });
    try {
      const http = await loadHostHttpConfig(dir);
      expect(http?.fetch).toBeTypeOf('function');
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      expect(await hostGet(http!, '/assistant/jobs')).toEqual({ ok: true, status: 200, data: { jobs: [] } });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(seen).toEqual([expect.objectContaining({ type: LOCAL_GATEWAY_RPC.HTTP_REQUEST, data: { method: 'GET', path: '/api/assistant/jobs' } })]);
    } finally {
      await control.close();
    }
  });

  it('falls back to the default listener', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'), 'log_level: info\n');
    expect(await loadHostHttpConfig(dir)).toEqual({ baseUrl: 'http://127.0.0.1:8086/api', token: '' });
  });
});
