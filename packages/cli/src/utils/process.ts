import { spawn, ChildProcess, exec } from 'child_process';
import fs from 'fs-extra';
import path from 'path';
import { logger } from './logger.js';
import os from 'os';

const PID_FILE = '.zhin.pid';

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

export async function startProcess(command: string, args: string[], cwd: string,daemon:boolean): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: daemon,
      stdio: 'inherit',
      shell:true,
      env: { ...process.env }
    });

    if(daemon) child.unref();

    child.on('spawn', () => {
      // 保存进程ID
      const pidFile = path.join(cwd, PID_FILE);
      fs.writeFileSync(pidFile, child.pid!.toString());
      logger.success(`机器人已启动，PID: ${child.pid}`);
      resolve(child);
    });

    child.on('error', (error) => {
      logger.error(`启动失败: ${error.message}`);
      reject(error);
    });

    // 设置超时检查
    setTimeout(() => {
      if (child.killed) {
        reject(new Error('进程启动超时'));
      }
    }, 5000);
  });
}

export async function stopProcess(cwd: string): Promise<void> {
  const pidFile = path.join(cwd, PID_FILE);
  
  if (!fs.existsSync(pidFile)) {
    logger.warn('没有找到运行中的机器人进程');
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
    
    // 检查进程是否存在
    const isRunning = await isProcessRunning(pid);
    if (!isRunning) {
      logger.warn('进程已不存在，清理PID文件');
      fs.removeSync(pidFile);
      return;
    }

    // 终止进程
    const killed = await killProcess(pid, 'SIGTERM');
    if (!killed) {
      logger.warn('无法终止进程，可能进程已结束');
      fs.removeSync(pidFile);
      return;
    }
    
    // 等待进程结束
    let attempts = 0;
    while (attempts < 30) {
      const stillRunning = await isProcessRunning(pid);
      if (!stillRunning) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    // 如果进程仍然存在，强制结束
    if (attempts >= 30) {
      logger.warn('进程未响应，尝试强制结束');
      await killProcess(pid, 'SIGKILL');
      
      // 再次等待
      attempts = 0;
      while (attempts < 10) {
        const stillRunning = await isProcessRunning(pid);
        if (!stillRunning) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
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

/**
 * 获取进程详细状态信息
 */
export async function getProcessStatusDetailed(cwd: string): Promise<{ 
  running: boolean; 
  pid?: number; 
  info?: { name: string; memory?: string; cpu?: string } 
}> {
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
    
    // 获取进程详细信息
    const info = await getProcessInfo(pid);
    
    return { running: true, pid, info: info || undefined };
  } catch {
    return { running: false };
  }
}

/**
 * 获取进程详细信息的跨平台实现
 */
async function getProcessInfo(pid: number): Promise<{ name: string; memory?: string; cpu?: string } | null> {
  return new Promise((resolve) => {
    const platform = os.platform();
    
    if (platform === 'win32') {
      // Windows: 使用 tasklist 命令获取详细信息
      exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (error, stdout) => {
        if (error || !stdout.trim() || stdout.includes('INFO: No tasks')) {
          resolve(null);
          return;
        }
        
        // 解析 CSV 格式输出: "进程名","PID","会话名","会话#","内存使用"
        const lines = stdout.trim().split('\n');
        if (lines.length > 0) {
          const parts = lines[0].split(',');
          if (parts.length >= 5) {
            const name = parts[0].replace(/"/g, '');
            const memory = parts[4].replace(/"/g, '');
            resolve({ name, memory });
          } else {
            resolve({ name: 'Unknown' });
          }
        } else {
          resolve(null);
        }
      });
    } else {
      // Linux/macOS: 使用 ps 命令获取详细信息
      exec(`ps -p ${pid} -o comm=,rss=,pcpu=`, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
          return;
        }
        
        const lines = stdout.trim().split('\n');
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          if (parts.length >= 3) {
            const name = parts[0];
            const memory = `${(parseInt(parts[1]) / 1024).toFixed(1)}MB`;
            const cpu = `${parseFloat(parts[2]).toFixed(1)}%`;
            resolve({ name, memory, cpu });
          } else {
            resolve({ name: 'Unknown' });
          }
        } else {
          resolve(null);
        }
      });
    }
  });
}

/**
 * 获取所有相关进程的列表
 */
async function getRelatedProcessesInternal(processName: string): Promise<Array<{ pid: number; name: string; memory?: string; cpu?: string }>> {
  return new Promise((resolve) => {
    const platform = os.platform();
    
    if (platform === 'win32') {
      // Windows: 使用 tasklist 命令
      exec(`tasklist /FI "IMAGENAME eq ${processName}*" /FO CSV /NH`, (error, stdout) => {
        if (error || !stdout.trim() || stdout.includes('INFO: No tasks')) {
          resolve([]);
          return;
        }
        
        const processes: Array<{ pid: number; name: string; memory?: string; cpu?: string }> = [];
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 5) {
            const name = parts[0].replace(/"/g, '');
            const pid = parseInt(parts[1].replace(/"/g, ''));
            const memory = parts[4].replace(/"/g, '');
            if (!isNaN(pid)) {
              processes.push({ pid, name, memory });
            }
          }
        }
        
        resolve(processes);
      });
    } else {
      // Linux/macOS: 使用 ps 命令
      exec(`ps -C "${processName}" -o pid=,comm=,rss=,pcpu=`, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve([]);
          return;
        }
        
        const processes: Array<{ pid: number; name: string; memory?: string; cpu?: string }> = [];
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 4) {
            const pid = parseInt(parts[0]);
            const name = parts[1];
            const memory = `${(parseInt(parts[2]) / 1024).toFixed(1)}MB`;
            const cpu = `${parseFloat(parts[3]).toFixed(1)}%`;
            if (!isNaN(pid)) {
              processes.push({ pid, name, memory, cpu });
            }
          }
        }
        
        resolve(processes);
      });
    }
  });
}

/**
 * 获取所有相关进程列表
 */
export async function getRelatedProcesses(processName: string): Promise<Array<{ 
  pid: number; 
  name: string; 
  memory?: string; 
  cpu?: string 
}>> {
  return await getRelatedProcessesInternal(processName);
} 