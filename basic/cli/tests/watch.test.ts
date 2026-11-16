import { afterEach, describe, it, expect, vi } from 'vitest';
import { createSerialTick, fetchWatchSnapshot } from '../src/commands/watch.js';
import {
  formatBytes,
  formatJobSchedule,
  formatNotifyChannel,
  formatUptime,
  jobRowsFromApi,
  renderMemorySection,
  instanceSampleFromStatus,
  processSampleFromApi,
  renderWatchText,
  systemInfoFromApi,
} from '../src/commands/watch-format.js';

describe('zhin watch format', () => {
  it('formatUptime', () => {
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(125)).toBe('2m 5s');
    expect(formatUptime(7200)).toBe('2h 0m');
  });

  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('2 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('renderMemorySection shows process and host memory', () => {
    const lines = renderMemorySection({
      processMemory: {
        rss: 200 * 1024 * 1024,
        heapUsed: 80 * 1024 * 1024,
        heapTotal: 100 * 1024 * 1024,
        external: 5 * 1024 * 1024,
      },
      osMemory: { freeMem: 4 * 1024 ** 3, totalMem: 16 * 1024 ** 3 },
    });
    const text = lines.join('\n');
    expect(text).toContain('rss');
    expect(text).toContain('freeMem');
    expect(text).toContain('totalMem');
    expect(text).toContain('usedMem');
  });

  // #1250 watch-memory-figures-inconsistent: every figure names its process and comes from that
  // process's one sample; rss below heapUsed (one sample, compressed pages) is explained.
  it('labels memory per process (instance / gateway), each from its own sample', () => {
    const MB = 1024 * 1024;
    const instance = instanceSampleFromStatus({
      pid: 7, memory: { rss: 1, heapUsed: 1, heapTotal: 1 },
      process: { role: 'instance', pid: 7, uptime: 1, sampledAt: 0, memory: { rss: 86.7 * MB, heapUsed: 222 * MB, heapTotal: 240 * MB, external: 2 * MB } },
    });
    expect(instance).toMatchObject({ role: 'instance', pid: 7, memory: { rss: 86.7 * MB, heapUsed: 222 * MB } });
    const gateway = processSampleFromApi({ role: 'gateway', pid: 3, uptime: 1, sampledAt: 0, memory: { rss: 60 * MB, heapUsed: 20 * MB, heapTotal: 30 * MB } }, 'gateway');
    expect(processSampleFromApi({ role: 'instance', memory: {} }, 'gateway')).toBeUndefined();
    const text = renderMemorySection({ osMemory: { freeMem: 1, totalMem: 2 } }, [instance!, gateway!]).join('\n');
    expect(text).toMatch(/instance +pid 7/u);
    expect(text).toMatch(/gateway +pid 3/u);
    expect(text.indexOf('86.7 MB')).toBeGreaterThan(text.indexOf('instance'));
    expect(text.indexOf('86.7 MB')).toBeLessThan(text.indexOf('gateway'));
    expect(text.indexOf('60.0 MB')).toBeGreaterThan(text.indexOf('gateway'));
    expect(text).toContain('同一次采样');
    // An older instance without `process`: its `memory` + `pid` are still one call.
    expect(instanceSampleFromStatus({ pid: 9, memory: { rss: 5, heapUsed: 4, heapTotal: 4 } })).toEqual({ role: 'instance', pid: 9, memory: { rss: 5, heapUsed: 4, heapTotal: 4, external: undefined, arrayBuffers: undefined } });
  });

  it('systemInfoFromApi parses osMemory', () => {
    const info = systemInfoFromApi({
      uptime: 10,
      memory: { rss: 1, heapUsed: 2, heapTotal: 3, external: 4 },
      osMemory: { freeMem: 100, totalMem: 200 },
      pid: 42,
    });
    expect(info?.osMemory?.freeMem).toBe(100);
    expect(info?.processMemory?.rss).toBe(1);
  });

  it('formatJobSchedule', () => {
    expect(formatJobSchedule({ kind: 'cron', expr: '0 8 * * *' })).toBe('cron 0 8 * * *');
    expect(formatJobSchedule({ kind: 'every', everyMs: 1_800_000 })).toBe('every 30m');
    expect(formatJobSchedule({ kind: 'event', source: 'script', eventType: 'test' })).toBe(
      'event:script/test',
    );
  });

  it('formatNotifyChannel', () => {
    expect(formatNotifyChannel({ channel: 'silent' })).toBe('silent');
    expect(
      formatNotifyChannel({ channel: 'im', platform: 'icqq', sceneId: '123' }),
    ).toBe('im/icqq/scene:123');
  });

  it('jobRowsFromApi', () => {
    const rows = jobRowsFromApi([
      {
        id: 'j1',
        label: '早报',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 8 * * *' },
        notify: { channel: 'im' },
        state: { lastStatus: 'ok' },
      },
    ]);
    expect(rows[0]?.schedule).toBe('cron 0 8 * * *');
    expect(rows[0]?.lastStatus).toBe('ok');
  });

  it('renderWatchText shows error hint when unreachable', () => {
    const text = renderWatchText({
      baseUrl: 'http://127.0.0.1:8086/api',
      fetchedAt: new Date('2026-06-05T10:00:00'),
      error: '无法连接',
    });
    expect(text).toContain('无法连接');
    expect(text).toContain('zhin start');
  });
});

describe('createSerialTick', () => {
  it('skips overlapping triggers while a tick is in flight', async () => {
    let calls = 0;
    let release!: () => void;
    const tick = () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const guarded = createSerialTick(tick);

    guarded();
    guarded();
    guarded();
    expect(calls).toBe(1);

    release();
    await Promise.resolve();
    guarded();
    expect(calls).toBe(2);
    release();
    await Promise.resolve();
  });

  it('recovers after a rejected tick', async () => {
    let calls = 0;
    const guarded = createSerialTick(() => {
      calls += 1;
      return Promise.reject(new Error('boom'));
    });
    guarded();
    await new Promise((resolve) => setTimeout(resolve, 0));
    guarded();
    expect(calls).toBe(2);
  });
});

describe('fetchWatchSnapshot', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads endpoints from the paginated introspection route and issues all reads at once', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const pathname = new URL(url).pathname;
      started.push(pathname);
      await gate;
      const data = pathname.endsWith('/introspection/endpoints')
        ? { items: [{ name: 'bot', adapter: 'icqq', status: 'online' }], totalPages: 1 }
        : pathname.endsWith('/assistant/jobs') ? { jobs: [], eventsActive: false } : {};
      return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
    }));

    const pending = fetchWatchSnapshot({ baseUrl: 'http://127.0.0.1:8086/api', token: '' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(started.sort()).toEqual([
      '/api/assistant/jobs', '/api/introspection/endpoints', '/api/stats', '/api/system/status',
    ]);
    release();
    const snapshot = await pending;
    expect(snapshot.ok).toBe(true);
    expect(snapshot.endpoints).toEqual([{ name: 'bot', adapter: 'icqq', status: 'online' }]);
    expect(snapshot.assistant).toEqual({ enabled: true, eventsActive: false, jobs: [] });
  });

  it('adds the gateway sample from gateway.instance.status next to the instance sample', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const pathname = new URL(url).pathname;
      const data = pathname.endsWith('/system/status')
        ? { pid: 7, memory: { rss: 3, heapUsed: 2, heapTotal: 2 }, process: { role: 'instance', pid: 7, uptime: 1, sampledAt: 5, memory: { rss: 3, heapUsed: 2, heapTotal: 2 } } }
        : pathname.endsWith('/introspection/endpoints') ? { items: [], totalPages: 1 } : {};
      return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
    }));
    const snapshot = await fetchWatchSnapshot({ baseUrl: 'http://127.0.0.1:8086/api', token: '' }, {
      gatewayStatus: async () => ({ state: 'running', gateway: { role: 'gateway', pid: 3, uptime: 1, sampledAt: 6, memory: { rss: 9, heapUsed: 8, heapTotal: 8 } } }),
    });
    expect(snapshot.processes).toEqual([
      { role: 'instance', pid: 7, sampledAt: 5, memory: expect.objectContaining({ rss: 3, heapUsed: 2 }) },
      { role: 'gateway', pid: 3, sampledAt: 6, memory: expect.objectContaining({ rss: 9, heapUsed: 8 }) },
    ]);
  });
});
