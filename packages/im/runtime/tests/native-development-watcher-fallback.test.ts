import { EventEmitter } from 'node:events';
import { mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakeWatcher extends EventEmitter {
  closed = false;
  constructor(readonly root: string, readonly notify: (event: string, name: string) => void) { super(); }
  close(): void { this.closed = true; }
}

const native = vi.hoisted(() => ({ watchers: [] as unknown[], refuse: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    watch: (root: string, _options: unknown, notify: (event: string, name: string) => void) => {
      if (native.refuse) throw Object.assign(new Error('too many open files'), { code: 'EMFILE' });
      const watcher = new FakeWatcher(root, notify);
      native.watchers.push(watcher);
      return watcher;
    },
  };
});

const { NativeDevelopmentModuleRuntime } = await import('../src/native-development-runtime.js');

describe('source watcher polling fallback', () => {
  let root: string;
  let stamp = 1_700_000_000;
  const watchers = () => native.watchers as FakeWatcher[];
  const touch = (name: string) => {
    const file = join(root, name);
    writeFileSync(file, 'export default 1;\n');
    stamp += 10;
    utimesSync(file, stamp, stamp);
    return file;
  };

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'zhin-watcher-fallback-')));
    native.watchers.length = 0;
    native.refuse = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { force: true, recursive: true });
  });

  it('polls once a second after a native error and returns to native watching on retry', async () => {
    const source = touch('plugin.ts');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: true });
    const changed: string[] = [];
    const dispose = runtime.watch((file) => changed.push(file));
    try {
      expect(watchers()).toHaveLength(1);
      const first = watchers()[0]!;
      first.notify('change', 'plugin.ts');
      expect(changed).toEqual([source]);

      first.emit('error', new Error('watcher failed'));
      expect(first.closed).toBe(true);
      changed.length = 0;
      touch('plugin.ts');
      vi.advanceTimersByTime(999);
      expect(changed).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(changed).toEqual([source]);
      // An unchanged tree stays quiet.
      vi.advanceTimersByTime(3000);
      expect(changed).toEqual([source]);
      expect(watchers()).toHaveLength(1);

      // The first retry re-attaches native handles, reports the gap and stops polling.
      touch('plugin.ts');
      vi.advanceTimersByTime(999);
      expect(watchers()).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(watchers()).toHaveLength(2);
      expect(changed).toEqual([source, source]);
      touch('plugin.ts');
      vi.advanceTimersByTime(120_000);
      expect(changed).toEqual([source, source]);
      watchers()[1]!.notify('change', 'plugin.ts');
      expect(changed).toEqual([source, source, source]);
      // A late error from the replaced handle does not degrade the live one.
      first.emit('error', new Error('late'));
      expect(watchers()[1]!.closed).toBe(false);
    } finally {
      dispose();
      await runtime.close();
    }
    expect(watchers()[1]!.closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('backs off between native retries while the platform keeps refusing', async () => {
    native.refuse = true;
    const source = touch('plugin.ts');
    const runtime = new NativeDevelopmentModuleRuntime({ projectRoot: root, watch: true });
    const changed: string[] = [];
    const attempts: number[] = [];
    const dispose = runtime.watch((file) => changed.push(file));
    try {
      // Refused up front: polling carries the changes.
      touch('plugin.ts');
      vi.advanceTimersByTime(1000);
      expect(changed).toEqual([source]);

      // Retries at 5s, then 10s, 20s, 40s and 60s (capped) after the previous one.
      const startedAt = Date.now() - 1000;
      native.refuse = false;
      const original = watchers().length;
      native.refuse = true;
      for (const at of [5_000, 15_000, 35_000, 75_000, 135_000, 195_000]) {
        vi.advanceTimersByTime(at - (Date.now() - startedAt) - 1);
        attempts.push(watchers().length);
        native.refuse = false;
        vi.advanceTimersByTime(1);
        const attached = watchers().length > original;
        expect(attached, `retry expected at ${at}ms`).toBe(true);
        // Make this attempt count as a failure: the handle errors right away.
        watchers().at(-1)!.emit('error', new Error('still failing'));
        native.watchers.length = original;
        native.refuse = true;
      }
      expect(attempts.every((count) => count === original)).toBe(true);
      // Still polling throughout.
      touch('plugin.ts');
      vi.advanceTimersByTime(1000);
      expect(changed.at(-1)).toBe(source);
      expect(changed.length).toBeGreaterThanOrEqual(2);
    } finally {
      dispose();
      await runtime.close();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
