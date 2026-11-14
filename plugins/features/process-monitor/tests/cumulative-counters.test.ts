import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateDeclarativeValue } from '@zhin.js/console-contract';
import page from '../pages/index/index.ts';
import { EVENT_RETENTION_MS, ProcessMonitor } from '../src/index.js';

const HOUR = 60 * 60 * 1000;
const dirs: string[] = [];
function stateFile(content?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-pm-cumulative-'));
  dirs.push(dir);
  const file = path.join(dir, 'process-state.json');
  if (content !== undefined) fs.writeFileSync(file, JSON.stringify(content));
  return file;
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

async function started(monitor: ProcessMonitor): Promise<void> {
  monitor.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  monitor.dispose();
}

describe('process monitor: this run vs cumulative (#1250)', () => {
  it('keeps legacy counters, estimates their start from the file, and starts timestamped events', async () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const file = stateFile({ lastPid: process.pid + 1, lastStartTime: now - 60_000, restartCount: 367, crashCount: 1125, totalUptime: 87 * 24 * HOUR });
    const birth = new Date(Date.UTC(2026, 0, 2, 12));
    fs.utimesSync(file, birth, birth);
    const monitor = new ProcessMonitor({ notifyOnCrash: false, notifyOnRestart: false, notifyOnStart: false }, { stateFile: file, now: () => now });
    await started(monitor);

    const status = monitor.getStatus('en');
    expect(status.crashCount).toBe(1126);
    expect(status.restartCount).toBe(367);
    expect(status.trackingSinceEstimated).toBe(true);
    expect(status.trackingSince).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(status.startReason).toBe('crash');
    // Only the crash seen after the upgrade has a timestamp; the window is still partial.
    expect(status.crashesLast24h).toBe(1);
    expect(status.restartsLast24h).toBe(0);
    expect(status.last24hComplete).toBe(false);
    expect(status.uptimeI18n.en).not.toMatch(/\p{Script=Han}/u);
    expect(status.totalUptimeI18n['zh-CN']).toContain('87天');

    const persisted = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(persisted).toMatchObject({ crashCount: 1126, restartCount: 367, trackingSinceEstimated: true });
    expect(persisted.events).toEqual([{ reason: 'crash', at: now }]);
  });

  it('counts only the last 24 hours and drops events past retention', async () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const file = stateFile({
      lastPid: process.pid + 1, lastStartTime: now - 10 * 60_000, cleanExit: true,
      restartCount: 3, crashCount: 2, totalUptime: 0, trackingSince: now - 40 * 24 * HOUR, eventsSince: now - 40 * 24 * HOUR,
      events: [
        { reason: 'crash', at: now - EVENT_RETENTION_MS - HOUR },
        { reason: 'crash', at: now - 30 * HOUR },
        { reason: 'crash', at: now - 2 * HOUR },
        { reason: 'restart', at: now - HOUR },
      ],
    });
    const monitor = new ProcessMonitor({ notifyOnCrash: false, notifyOnRestart: false, notifyOnStart: false }, { stateFile: file, now: () => now });
    await started(monitor);
    const status = monitor.getStatus();
    expect(status.startReason).toBe('restart');
    expect(status.crashesLast24h).toBe(1);
    expect(status.restartsLast24h).toBe(2);
    expect(status.last24hComplete).toBe(true);
    expect(status.trackingSinceEstimated).toBe(false);
    expect(monitor.state.events?.some(event => event.at < now - EVENT_RETENTION_MS)).toBe(false);
  });

  it('a fresh state file records its own start', async () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const file = stateFile();
    const monitor = new ProcessMonitor({ notifyOnStart: false }, { stateFile: file, now: () => now });
    await started(monitor);
    expect(monitor.getStatus()).toMatchObject({ trackingSinceEstimated: false, restartCount: 0, crashCount: 0, startReason: 'start' });
    expect(monitor.formatStatus('zh-CN')).toContain('以上累计自');
  });

  it('labels this run and the totals separately, localized, with the since date', () => {
    const spec = (page as unknown as { spec: {
      stats: { key?: string; label: { zh: string; en: string }; value: unknown; hint?: unknown }[];
      sections: { id?: string; entries?: { label: unknown }[] }[];
    } }).spec;
    const stat = (key: string) => spec.stats.find(item => item.key === key)!;
    expect(stat('restartCount').label.zh).toBe('累计重启');
    expect(stat('crashCount').label.zh).toBe('累计崩溃');
    expect(stat('uptime').label.zh).toBe('本次运行时长');
    const data = { trackingSince: '2026-01-02', uptimeI18n: { 'zh-CN': '1天2小时', en: '1d 2h' }, restartsLast24h: 0 };
    expect(evaluateDeclarativeValue(stat('restartCount').hint, data, 'zh-CN')).toBe('自 2026-01-02 起累计');
    expect(evaluateDeclarativeValue(stat('uptime').value, data, 'en')).toBe('1d 2h');
    expect(evaluateDeclarativeValue(stat('uptime').value, data, 'zh-CN')).toBe('1天2小时');
    expect(spec.sections.map(section => section.id)).toEqual(['current-run', 'cumulative']);
    for (const section of spec.sections) {
      for (const entry of section.entries ?? []) {
        expect(entry.label).toEqual({ zh: expect.any(String), en: expect.any(String) });
      }
    }
  });
});
