/**
 * Docker 沙箱 — 真实容器级隔离
 *
 * 使用 Docker 容器执行 bash 命令，提供：
 * - 文件系统隔离（只挂载工作目录）
 * - 网络隔离（默认无网络）
 * - 资源限制（内存、CPU）
 * - 进程隔离（独立 PID 命名空间）
 *
 * 降级策略：Docker 不可用时回退到软沙箱。
 */

import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import type { SandboxConfig, SandboxResult } from './sandbox.js';

/** Docker 沙箱配置 */
export interface DockerSandboxConfig extends SandboxConfig {
  /** Docker 镜像（默认 node:20-alpine） */
  dockerImage?: string;
  /** 是否启用网络（默认 false） */
  enableNetwork?: boolean;
}

const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  enabled: true,
  timeout: 30000,
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  maxOutputSize: 10 * 1024 * 1024,
  preserveHome: false,
  preservePath: true,
  enableNetwork: false,
  dockerImage: 'node:20-alpine',
};

/**
 * 检测 Docker 是否可用
 */
export function isDockerAvailable(): boolean {
  try {
    const result = child_process.spawnSync('docker', ['info'], {
      timeout: 5000,
      stdio: 'pipe',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * 确保 Docker 镜像存在（不存在则拉取）
 */
function ensureImage(image: string): { ok: boolean; error?: string } {
  try {
    // 检查镜像是否存在
    const check = child_process.spawnSync('docker', ['image', 'inspect', image], {
      timeout: 5000,
      stdio: 'pipe',
    });
    if (check.status === 0) return { ok: true };

    // 拉取镜像
    const pull = child_process.spawnSync('docker', ['pull', image], {
      timeout: 120000,
      stdio: 'pipe',
    });
    return pull.status === 0
      ? { ok: true }
      : { ok: false, error: `拉取镜像 ${image} 失败` };
  } catch (e) {
    return { ok: false, error: `Docker 操作失败: ${e}` };
  }
}

/**
 * 在 Docker 容器中执行命令
 */
export async function executeInDocker(
  command: string,
  config: Partial<DockerSandboxConfig> = {},
): Promise<SandboxResult> {
  const merged: DockerSandboxConfig = { ...DEFAULT_DOCKER_CONFIG, ...config };
  const startTime = Date.now();

  // 确保镜像存在
  const imageCheck = ensureImage(merged.dockerImage!);
  if (!imageCheck.ok) {
    return {
      success: false,
      stdout: '',
      stderr: imageCheck.error || 'Docker 镜像不可用',
      exitCode: 1,
      duration: Date.now() - startTime,
      timedOut: false,
      blocked: true,
      blockReason: imageCheck.error,
    };
  }

  const timeout = merged.timeout || 30000;
  const maxOutput = merged.maxOutputSize || 10 * 1024 * 1024;
  const cwd = merged.workingDirectory || process.cwd();

  // 构建 docker run 参数
  const dockerArgs: string[] = [
    'run',
    '--rm',                          // 执行完自动删除容器
    '--read-only',                    // 只读文件系统
    '--tmpfs', '/tmp:size=64m',      // /tmp 可写，限制 64MB
    '--memory', `${merged.maxMemoryMB}m`,
    '--cpus', `${(merged.maxCpuPercent || 50) / 100}`,
    '--pids-limit', '64',            // 进程数限制
    '--security-opt', 'no-new-privileges',  // 禁止提权
    '--cap-drop', 'ALL',             // 丢弃所有 capabilities
    '--workdir', '/workspace',
    '-v', `${cwd}:/workspace:ro`,    // 只读挂载工作目录
  ];

  // 网络隔离
  if (!merged.enableNetwork) {
    dockerArgs.push('--network', 'none');
  }

  // 环境变量清理
  if (merged.allowedEnvVars) {
    for (const varName of merged.allowedEnvVars) {
      const value = process.env[varName];
      if (value) {
        dockerArgs.push('-e', `${varName}=${value}`);
      }
    }
  }

  // 镜像和命令
  dockerArgs.push(merged.dockerImage!, 'sh', '-c', command);

  return new Promise((resolve) => {
    let timedOut = false;

    const child = child_process.spawn('docker', dockerArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: string[] = [];
    let stdoutLen = 0;
    const stderrChunks: string[] = [];
    let stderrLen = 0;

    child.stdout?.on('data', (data) => {
      const chunk = data.toString();
      if (stdoutLen + chunk.length <= maxOutput) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    child.stderr?.on('data', (data) => {
      const chunk = data.toString();
      if (stderrLen + chunk.length <= maxOutput) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      // 尝试强制删除容器
      try {
        child_process.spawnSync('docker', ['kill', `$(docker ps -q --filter "ancestor=${merged.dockerImage}")`], {
          timeout: 3000,
          stdio: 'pipe',
        });
      } catch { /* ignore */ }
    }, timeout);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        success: exitCode === 0 && !timedOut,
        stdout: stdoutChunks.join('').slice(0, maxOutput),
        stderr: stderrChunks.join('').slice(0, maxOutput),
        exitCode,
        duration: Date.now() - startTime,
        timedOut,
        blocked: false,
      });
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout: stdoutChunks.join(''),
        stderr: `Docker 执行错误: ${error.message}`,
        exitCode: 1,
        duration: Date.now() - startTime,
        timedOut: false,
        blocked: false,
      });
    });
  });
}
