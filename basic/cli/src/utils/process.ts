import { exec } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { formatCompact } from '@zhin.js/logger';
import { logger } from './logger.js';
import os from 'os';
import { DEFAULT_SHUTDOWN_BUDGET_MS } from '../plugin-runtime/process-lifecycle.js';

const PID_FILE = '.zhin.pid';
const PROCESS_EXIT_POLL_MS = 100;
/** The supervisor must outlive the Runtime child's complete graceful-stop budget. */
export const PROCESS_STOP_GRACE_MS = DEFAULT_SHUTDOWN_BUDGET_MS + 2_000;

/**
 * 检查进程是否存在的跨平台实现
 */
async function isProcessRunning(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = os.platform();
    
    if (platform === 'win32') {
      // Windows: 使用 tasklist 命令
      exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        // tasklist 输出包含进程信息表示进程存在
        resolve(stdout.trim().length > 0 && !stdout.includes('INFO: No tasks'));
      });
    } else {
      // Linux/macOS: 使用 ps 命令
      exec(`ps -p ${pid} -o pid=`, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        // ps 输出包含 PID 表示进程存在
        resolve(stdout.trim().length > 0);
      });
    }
  });
}

/**
 * 终止进程的跨平台实现
 */
async function killProcess(pid: number, signal: string = 'SIGTERM'): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = os.platform();
    
    if (platform === 'win32') {
      // Windows: 使用 taskkill 命令
      const forceFlag = signal === 'SIGKILL' ? '/F' : '';
      exec(`taskkill /PID ${pid} ${forceFlag}`, (error) => {
        resolve(!error);
      });
    } else {
      // Linux/macOS: 使用 kill 命令
      const signalFlag = signal === 'SIGKILL' ? '-9' : '-15';
      exec(`kill ${signalFlag} ${pid}`, (error) => {
        resolve(!error);
      });
    }
  });
}

export async function stopProcess(cwd: string): Promise<void> {
  const pidFile = path.join(cwd, PID_FILE);
  
  if (!fs.existsSync(pidFile)) {
    logger.warn(formatCompact( { op: 'no_process' }));
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
    
    // 检查进程是否存在
    const isRunning = await isProcessRunning(pid);
    if (!isRunning) {
      logger.warn(formatCompact( { op: 'stale_pid', action: 'cleanup' }));
      fs.removeSync(pidFile);
      return;
    }

    // 终止进程
    const killed = await killProcess(pid, 'SIGTERM');
    if (!killed) {
      logger.warn(formatCompact( { op: 'kill_failed' }));
      fs.removeSync(pidFile);
      return;
    }
    
    // 等待进程结束
    let waitedMs = 0;
    while (waitedMs < PROCESS_STOP_GRACE_MS) {
      const stillRunning = await isProcessRunning(pid);
      if (!stillRunning) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, PROCESS_EXIT_POLL_MS));
      waitedMs += PROCESS_EXIT_POLL_MS;
    }

    // 如果进程仍然存在，强制结束
    if (waitedMs >= PROCESS_STOP_GRACE_MS) {
      logger.warn(formatCompact( { op: 'kill', signal: 'SIGKILL' }));
      await killProcess(pid, 'SIGKILL');
      
      // 再次等待
      waitedMs = 0;
      while (waitedMs < 1_000) {
        const stillRunning = await isProcessRunning(pid);
        if (!stillRunning) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, PROCESS_EXIT_POLL_MS));
        waitedMs += PROCESS_EXIT_POLL_MS;
      }
    }

    fs.removeSync(pidFile);
    logger.success('机器人已停止');
    
  } catch (error) {
    logger.error(`停止进程时发生错误: ${error}`);
    // 清理PID文件
    fs.removeSync(pidFile);
  }
}

export async function getProcessStatus(cwd: string): Promise<{ running: boolean; pid?: number }> {
  const pidFile = path.join(cwd, PID_FILE);
  
  if (!fs.existsSync(pidFile)) {
    return { running: false };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
    
    // 检查进程是否存在
    const isRunning = await isProcessRunning(pid);
    if (!isRunning) {
      // 进程不存在，清理PID文件
      fs.removeSync(pidFile);
      return { running: false };
    }
    
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}
