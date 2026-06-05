import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatJobSchedule,
  formatNotifyChannel,
  formatUptime,
  jobRowsFromApi,
  renderMemorySection,
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
    expect(text).toContain('zhin dev');
  });
});
