import { execFile } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { formatCompact } from '@zhin.js/logger';
import { logger } from './logger.js';
import os from 'os';
import { DEFAULT_SHUTDOWN_BUDGET_MS } from '@zhin.js/runtime';

const PID_FILE = '.zhin.pid';
const PROCESS_EXIT_POLL_MS = 100;
/** The supervisor must outlive the Runtime child's complete graceful-stop budget. */
export const PROCESS_STOP_GRACE_MS = DEFAULT_SHUTDOWN_BUDGET_MS + 2_000;

/** Signal 0 probes liveness without a shell; EPERM means the pid exists but belongs to someone else. */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface ProcessControl {
  isRunning(pid: number): boolean;
  /** Returns false when the termination request itself was rejected. */
  terminate(pid: number, force: boolean): Promise<boolean>;
}

function terminateProcess(pid: number, force: boolean): Promise<boolean> {
  if (os.platform() === 'win32') {
    // Windows has no SIGTERM: taskkill without /F asks the process to close and
    // fails for windowless daemons; /T also takes the supervised Runtime child.
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), ...(force ? ['/T', '/F'] : [])], (error) => resolve(!error));
    });
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

const systemProcessControl: ProcessControl = { isRunning: isProcessRunning, terminate: terminateProcess };

export type StopPidOutcome = 'not_running' | 'stopped' | 'kill_failed' | 'still_running';

async function waitForExit(
  pid: number,
  control: ProcessControl,
  budgetMs: number,
  pollMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  for (let waitedMs = 0; waitedMs < budgetMs; waitedMs += pollMs) {
    if (!control.isRunning(pid)) return true;
    await sleep(pollMs);
  }
  return !control.isRunning(pid);
}

/**
 * Graceful stop, then force. Only `not_running` and `stopped` mean the pid is gone:
 * the caller must keep the pid file otherwise, or the daemon becomes an untracked orphan.
 */
export async function stopPid(
  pid: number,
  control: ProcessControl = systemProcessControl,
  options: Readonly<{ graceMs?: number; forceWaitMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> }> = {},
): Promise<StopPidOutcome> {
  const {
    graceMs = PROCESS_STOP_GRACE_MS,
    forceWaitMs = 1_000,
    pollMs = PROCESS_EXIT_POLL_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  } = options;
  if (!control.isRunning(pid)) return 'not_running';

  const graceful = await control.terminate(pid, false);
  if (graceful && await waitForExit(pid, control, graceMs, pollMs, sleep)) return 'stopped';

  // Either the graceful request was rejected (Windows taskkill without /F) or the grace budget ran out.
  logger.warn(formatCompact({ op: 'kill', signal: 'SIGKILL' }));
  const forced = await control.terminate(pid, true);
  if (await waitForExit(pid, control, forceWaitMs, pollMs, sleep)) return 'stopped';
  return forced ? 'still_running' : 'kill_failed';
}

export async function stopProcess(cwd: string, control: ProcessControl = systemProcessControl): Promise<void> {
  const pidFile = path.join(cwd, PID_FILE);

  if (!fs.existsSync(pidFile)) {
    logger.warn(formatCompact( { op: 'no_process' }));
    return;
  }

  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    logger.warn(formatCompact({ op: 'stale_pid', action: 'cleanup' }));
    fs.removeSync(pidFile);
    return;
  }

  const outcome = await stopPid(pid, control);
  if (outcome === 'not_running') {
    logger.warn(formatCompact( { op: 'stale_pid', action: 'cleanup' }));
    fs.removeSync(pidFile);
    return;
  }
  if (outcome === 'stopped') {
    fs.removeSync(pidFile);
    logger.success('机器人已停止');
    return;
  }
  // The process is still alive: keep the pid file so a later `zhin stop` can find it.
  logger.error(formatCompact({ op: outcome, pid, pidFile: PID_FILE, action: 'kept_pid_file' }));
  throw new Error(`无法终止进程 ${pid}（${outcome}）；已保留 ${PID_FILE}`);
}

export async function getProcessStatus(cwd: string): Promise<{ running: boolean; pid?: number }> {
  const pidFile = path.join(cwd, PID_FILE);
  
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);

    if (!Number.isInteger(pid) || pid <= 0 || !isProcessRunning(pid)) {
      // 进程不存在，清理PID文件
      fs.removeSync(pidFile);
      return { running: false };
    }
    
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}
