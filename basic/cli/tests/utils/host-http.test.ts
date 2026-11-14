import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  connectableHost, hostGet, HostTargetError, listHostEndpoints, loadHostHttpConfig, normalizeHostUrl, verifyHostProject,
} from '../../src/utils/host-http.js';
import { LOCAL_GATEWAY_RPC, LocalControlServer } from '@zhin.js/gateway/local';
import { projectIdentity } from '@zhin.js/gateway/project';

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

  it('resolves the token of an explicit --host through .env and lets .env.<environment> override it', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'),
      'http:\n  host: 0.0.0.0\n  port: 9100\n  base: /admin/\n  token: ${ZHIN_TEST_HOST_HTTP_TOKEN}\n');
    fs.writeFileSync(path.join(dir, '.env'), 'ZHIN_TEST_HOST_HTTP_TOKEN="base-token"\n');
    const host = { host: 'https://bot.example.com/admin/' };
    expect(await loadHostHttpConfig(dir, 'development', host))
      .toEqual({ baseUrl: 'https://bot.example.com/admin', token: 'base-token' });

    fs.writeFileSync(path.join(dir, '.env.production'), 'ZHIN_TEST_HOST_HTTP_TOKEN=prod-token\n');
    expect((await loadHostHttpConfig(dir, 'production', host))?.token).toBe('prod-token');
    expect((await loadHostHttpConfig(dir, 'development', host))?.token).toBe('base-token');
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

  it.runIf(process.platform !== 'win32')('sends only an explicit ZHIN_CONSOLE_TOKEN over the local socket, never http.token', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhh-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'), 'http:\n  port: 9100\n  token: bootstrap-token\n');
    const control = await LocalControlServer.open({ path: path.join(dir, '.zhin', 'gateway.sock') });
    const seen: Array<{ data?: unknown }> = [];
    control.setHandler(async (request) => {
      if (request.type === LOCAL_GATEWAY_RPC.INFO) return { ok: true, data: { gateway: {}, instance: {}, consoleInitialized: true } };
      seen.push(request);
      return { ok: true, data: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"success":true,"data":1}' } };
    });
    const previous = process.env.ZHIN_CONSOLE_TOKEN;
    try {
      delete process.env.ZHIN_CONSOLE_TOKEN;
      const owner = await loadHostHttpConfig(dir);
      expect(owner?.token).toBe('');
      await hostGet(owner!, '/stats');
      expect(seen.at(-1)!.data).not.toHaveProperty('token');
      process.env.ZHIN_CONSOLE_TOKEN = 'user-api-token';
      const user = await loadHostHttpConfig(dir);
      await hostGet(user!, '/stats');
      expect(seen.at(-1)!.data).toMatchObject({ token: 'user-api-token' });
    } finally {
      if (previous === undefined) delete process.env.ZHIN_CONSOLE_TOKEN;
      else process.env.ZHIN_CONSOLE_TOKEN = previous;
      await control.close();
    }
  });

  it('never falls back to the configured port when this project\'s gateway is not running (#1250)', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'), 'http:\n  port: 8068\n  token: bootstrap-token\n');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const previous = process.env.ZHIN_CONSOLE_TOKEN;
    process.env.ZHIN_CONSOLE_TOKEN = 'user-api-token';
    try {
      const error = await loadHostHttpConfig(dir).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HostTargetError);
      expect(error).toMatchObject({ code: 'gateway-not-running', message: expect.stringContaining('本项目的网关未运行') });
      expect((error as Error).message).toContain('--host');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.ZHIN_CONSOLE_TOKEN;
      else process.env.ZHIN_CONSOLE_TOKEN = previous;
    }
  });

  it('checks the project of an explicit loopback --host before returning it (#1250)', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'), 'http:\n  port: 8068\n');
    const health = (id?: string) => vi.fn(async () => new Response(JSON.stringify({ success: true, status: 'ok', ...(id ? { project: { id } } : {}) })));
    const other = health(projectIdentity(path.join(dir, 'elsewhere')));
    await expect(loadHostHttpConfig(dir, 'development', { host: 'http://127.0.0.1:8068', fetch: other as never }))
      .rejects.toMatchObject({ code: 'project-mismatch' });
    expect(other).toHaveBeenCalledWith('http://127.0.0.1:8068/pub/health', expect.anything());
    const same = health(projectIdentity(dir));
    expect(await loadHostHttpConfig(dir, 'development', { host: 'http://localhost:8068/', fetch: same as never }))
      .toEqual({ baseUrl: 'http://localhost:8068/api', token: '' });
  });

  it('refuses a loopback --host that reports no project id unless --allow-unverified-host (#1250)', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-host-http-'));
    fs.writeFileSync(path.join(dir, 'zhin.config.yml'), 'http:\n  port: 8068\n  token: bootstrap-token\n');
    const previous = process.env.ZHIN_CONSOLE_TOKEN;
    process.env.ZHIN_CONSOLE_TOKEN = 'user-api-token';
    try {
      const anonymous = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ success: true, status: 'ok' })));
      const error = await loadHostHttpConfig(dir, 'development', { host: 'http://127.0.0.1:8068', fetch: anonymous as never })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(HostTargetError);
      expect(error).toMatchObject({ code: 'project-unverified', message: expect.stringContaining('--allow-unverified-host') });
      expect((error as Error).message).toContain('未发送请求和令牌');
      // Only the health probe went out, and it carried no credential.
      expect(anonymous.mock.calls.map(([url]) => url)).toEqual(['http://127.0.0.1:8068/pub/health']);
      expect(JSON.stringify(anonymous.mock.calls[0]![1])).not.toContain('user-api-token');
      expect((anonymous.mock.calls[0]![1] as RequestInit).headers).toBeUndefined();

      const warn = vi.fn();
      expect(await loadHostHttpConfig(dir, 'development', { host: 'http://127.0.0.1:8068', fetch: anonymous as never, warn, allowUnverifiedHost: true }))
        .toEqual({ baseUrl: 'http://127.0.0.1:8068/api', token: 'user-api-token' });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('--allow-unverified-host'));
    } finally {
      if (previous === undefined) delete process.env.ZHIN_CONSOLE_TOKEN;
      else process.env.ZHIN_CONSOLE_TOKEN = previous;
    }
  });
});

describe('verifyHostProject (#1250)', () => {
  const root = path.join(os.tmpdir(), 'zhin-verify-project');
  const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)));

  it('refuses a loopback gateway of another project', async () => {
    const fetch = reply({ project: { id: projectIdentity(`${root}-a`) } });
    await expect(verifyHostProject('http://127.0.0.1:8068/api', root, { fetch: fetch as never })).rejects.toBeInstanceOf(HostTargetError);
  });

  it('accepts its own project', async () => {
    await expect(verifyHostProject('http://[::1]:8068/api', root, { fetch: reply({ project: { id: projectIdentity(root) } }) as never })).resolves.toBeUndefined();
  });

  it('refuses a loopback target that reports no project id by default', async () => {
    const warn = vi.fn();
    await expect(verifyHostProject('http://127.0.0.1:8068/api', root, { fetch: reply({ status: 'ok' }) as never, warn }))
      .rejects.toMatchObject({ code: 'project-unverified', message: expect.stringContaining('没有报告项目标识') });
    // A non-JSON reply (e.g. a 404 page) reports no id either.
    const notFound = vi.fn(async () => new Response('Not Found', { status: 404 }));
    await expect(verifyHostProject('http://localhost:8068/api', root, { fetch: notFound as never }))
      .rejects.toMatchObject({ code: 'project-unverified' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns and continues on a target without project id with allowUnverifiedHost', async () => {
    const warn = vi.fn();
    await expect(verifyHostProject('http://127.0.0.1:8068/api', root, { fetch: reply({ status: 'ok' }) as never, warn, allowUnverifiedHost: true }))
      .resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('没有报告项目标识'));
    // The flag never accepts another project's gateway.
    await expect(verifyHostProject('http://127.0.0.1:8068/api', root, { fetch: reply({ project: { id: projectIdentity(`${root}-a`) } }) as never, allowUnverifiedHost: true }))
      .rejects.toMatchObject({ code: 'project-mismatch' });
  });

  it('does not probe remote hosts named explicitly', async () => {
    const fetch = vi.fn();
    await verifyHostProject('https://bot.example.com/api', root, { fetch: fetch as never });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes --host and refuses credentials in it', () => {
    expect(normalizeHostUrl('http://127.0.0.1:8068')).toBe('http://127.0.0.1:8068/api');
    expect(normalizeHostUrl('https://h.test/custom/')).toBe('https://h.test/custom');
    expect(() => normalizeHostUrl('http://user:pass@h.test')).toThrow(HostTargetError);
    expect(() => normalizeHostUrl('ftp://h.test')).toThrow(HostTargetError);
  });
});
