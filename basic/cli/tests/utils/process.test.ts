import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProcessStatus,
  isProcessRunning,
  stopPid,
  stopProcess,
  type ProcessControl,
} from '../../src/utils/process.js';

const fast = { graceMs: 30, forceWaitMs: 30, pollMs: 10, sleep: async () => undefined };

/** A fake process that dies on the configured request. */
function fakeControl(behaviour: { graceful: 'dies' | 'ignored' | 'rejected'; force: 'dies' | 'ignored' | 'rejected' }) {
  let alive = true;
  const calls: boolean[] = [];
  const control: ProcessControl = {
    isRunning: () => alive,
    terminate: async (_pid, force) => {
      calls.push(force);
      const mode = force ? behaviour.force : behaviour.graceful;
      if (mode === 'dies') alive = false;
      return mode !== 'rejected';
    },
  };
  return { control, calls };
}

describe('isProcessRunning', () => {
  it('uses signal 0: true for this process, false for an invalid pid, true on EPERM', () => {
    expect(isProcessRunning(process.pid)).toBe(true);
    const kill = vi.spyOn(process, 'kill');
    kill.mockImplementationOnce(() => { throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' }); });
    expect(isProcessRunning(123456)).toBe(false);
    kill.mockImplementationOnce(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); });
    expect(isProcessRunning(1)).toBe(true);
    kill.mockRestore();
  });
});

describe('stopPid', () => {
  it('reports a pid that is already gone', async () => {
    const control: ProcessControl = { isRunning: () => false, terminate: vi.fn(async () => true) };
    expect(await stopPid(1, control, fast)).toBe('not_running');
    expect(control.terminate).not.toHaveBeenCalled();
  });

  it('stops gracefully without forcing', async () => {
    const f = fakeControl({ graceful: 'dies', force: 'dies' });
    expect(await stopPid(1, f.control, fast)).toBe('stopped');
    expect(f.calls).toEqual([false]);
  });

  it('falls back to force when the graceful request is rejected (Windows taskkill without /F)', async () => {
    const f = fakeControl({ graceful: 'rejected', force: 'dies' });
    expect(await stopPid(1, f.control, fast)).toBe('stopped');
    expect(f.calls).toEqual([false, true]);
  });

  it('forces after the grace budget', async () => {
    const f = fakeControl({ graceful: 'ignored', force: 'dies' });
    expect(await stopPid(1, f.control, fast)).toBe('stopped');
    expect(f.calls).toEqual([false, true]);
  });

  it('distinguishes a rejected force from a process that survives it', async () => {
    expect(await stopPid(1, fakeControl({ graceful: 'rejected', force: 'rejected' }).control, fast)).toBe('kill_failed');
    expect(await stopPid(1, fakeControl({ graceful: 'ignored', force: 'ignored' }).control, fast)).toBe('still_running');
  });
});

describe('stopProcess pid file', () => {
  let dir: string;
  let pidFile: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-stop-'));
    pidFile = path.join(dir, '.zhin.pid');
    fs.writeFileSync(pidFile, '4242');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('keeps the pid file when the process could not be terminated', async () => {
    const control: ProcessControl = { isRunning: () => true, terminate: async () => false };
    vi.useFakeTimers();
    const stopping = stopProcess(dir, control).catch((error: Error) => error);
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    const failure = await stopping;
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('4242');
    expect(fs.readFileSync(pidFile, 'utf8')).toBe('4242');
  });

  it('removes the pid file once the process is gone', async () => {
    await stopProcess(dir, fakeControl({ graceful: 'dies', force: 'dies' }).control);
    expect(fs.existsSync(pidFile)).toBe(false);
  });

  it('removes a stale or unparsable pid file', async () => {
    await stopProcess(dir, { isRunning: () => false, terminate: async () => true });
    expect(fs.existsSync(pidFile)).toBe(false);
    fs.writeFileSync(pidFile, 'not-a-pid');
    expect(await getProcessStatus(dir)).toEqual({ running: false });
    expect(fs.existsSync(pidFile)).toBe(false);
  });
});
