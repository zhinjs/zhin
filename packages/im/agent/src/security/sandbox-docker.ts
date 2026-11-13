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
import { randomUUID } from 'node:crypto';
import type { SandboxConfig, SandboxResult } from './sandbox.js';
import {
  CONTAINER_WORKSPACE,
  missingMountPointDirs,
  overlayDockerArgs,
  removeMountPointDirs,
} from './sandbox-mounts.js';

/** Docker 沙箱配置 */
export interface DockerSandboxConfig extends SandboxConfig {
  /** Docker 镜像（默认 node:22-bookworm-slim，自带 bash） */
  dockerImage?: string;
  /** 是否启用网络（默认 false） */
  enableNetwork?: boolean;
}

/** Matches the repo's Node floor and ships bash, which the exec policy parses for. */
export const DEFAULT_SANDBOX_DOCKER_IMAGE = 'node:22-bookworm-slim';

const DEFAULT_DOCKER_CONFIG: DockerSandboxConfig = {
  enabled: true,
  timeout: 30000,
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  maxOutputSize: 10 * 1024 * 1024,
  preserveHome: false,
  preservePath: true,
  enableNetwork: false,
  dockerImage: DEFAULT_SANDBOX_DOCKER_IMAGE,
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

/** Run a docker CLI command without blocking the event loop; resolves false on failure or timeout. */
function runDocker(args: readonly string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child = child_process.spawn('docker', [...args], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
  });
}

/** Images already confirmed present; only positive results are cached so a later pull can succeed. */
const verifiedImages = new Set<string>();
const pendingImageChecks = new Map<string, Promise<{ ok: boolean; error?: string }>>();

/**
 * 确保 Docker 镜像存在（不存在则拉取）。每个镜像只在首次成功前检查，且不阻塞事件循环。
 */
export function ensureImage(
  image: string,
  run: (args: readonly string[], timeoutMs: number) => Promise<boolean> = runDocker,
): Promise<{ ok: boolean; error?: string }> {
  if (verifiedImages.has(image)) return Promise.resolve({ ok: true });
  const pending = pendingImageChecks.get(image);
  if (pending) return pending;
  const check = (async () => {
    try {
      if (await run(['image', 'inspect', image], 5000) || await run(['pull', image], 120000)) {
        verifiedImages.add(image);
        return { ok: true };
      }
      return { ok: false, error: `拉取镜像 ${image} 失败` };
    } catch (e) {
      return { ok: false, error: `Docker 操作失败: ${e}` };
    } finally {
      pendingImageChecks.delete(image);
    }
  })();
  pendingImageChecks.set(image, check);
  return check;
}

/** Unique per-run container name so a timeout or cancel kills exactly this container. */
export function createSandboxContainerName(): string {
  return `zhin-sandbox-${randomUUID()}`;
}

export function buildDockerKillArgs(containerName: string): string[] {
  return ['kill', containerName];
}

/** Fire-and-forget `docker kill <name>`; the container is `--rm`, so killing it also removes it. */
function killContainer(containerName: string): void {
  try {
    const killer = child_process.spawn('docker', buildDockerKillArgs(containerName), { stdio: 'ignore' });
    killer.on('error', () => { /* docker gone: nothing left to kill */ });
    killer.unref();
  } catch { /* ignore */ }
}

/**
 * `docker run` arguments (pure). Read-only overlays only apply on top of a writable workspace
 * mount, and always come after it so parent mounts precede child mounts.
 */
export function buildDockerRunArgs(
  command: string,
  config: Partial<DockerSandboxConfig>,
  cwd: string,
  env: NodeJS.ProcessEnv = {},
  containerName?: string,
): string[] {
  const merged: DockerSandboxConfig = { ...DEFAULT_DOCKER_CONFIG, ...config };
  const writable = merged.filesystemAccess === 'workspace-write';
  const dockerArgs: string[] = [
    'run',
    '--rm',                          // 执行完自动删除容器
    ...(containerName ? ['--name', containerName] : []),
    '--read-only',                    // 只读文件系统
    '--tmpfs', '/tmp:size=64m',      // /tmp 可写，限制 64MB
    '--memory', `${merged.maxMemoryMB}m`,
    '--cpus', `${(merged.maxCpuPercent || 50) / 100}`,
    '--pids-limit', '64',            // 进程数限制
    '--security-opt', 'no-new-privileges',  // 禁止提权
    '--cap-drop', 'ALL',             // 丢弃所有 capabilities
    '--workdir', CONTAINER_WORKSPACE,
    '-v', `${cwd}:${CONTAINER_WORKSPACE}:${writable ? 'rw' : 'ro'}`,
  ];
  // Writable turns: every read-only overlay. Read-only turns: the workspace is :ro already, but the
  // hiding overlays (`.zhin/` behind an empty tmpfs) still apply.
  if (merged.readOnlyOverlays?.length) {
    dockerArgs.push(...overlayDockerArgs(writable ? merged.readOnlyOverlays : merged.readOnlyOverlays.filter(overlay => overlay.kind === 'tmpfs-dir')));
  }
  if (!merged.enableNetwork) {
    dockerArgs.push('--network', 'none');
  }
  if (merged.allowedEnvVars) {
    for (const varName of merged.allowedEnvVars) {
      const value = env[varName];
      if (value) dockerArgs.push('-e', `${varName}=${value}`);
    }
  }
  dockerArgs.push(merged.dockerImage!, 'bash', '-c', command);
  return dockerArgs;
}

/**
 * 在 Docker 容器中执行命令
 */
export async function executeInDocker(
  command: string,
  config: Partial<DockerSandboxConfig> = {},
  options: { signal?: AbortSignal } = {},
): Promise<SandboxResult> {
  const merged: DockerSandboxConfig = { ...DEFAULT_DOCKER_CONFIG, ...config };
  const startTime = Date.now();

  // 确保镜像存在
  const imageCheck = await ensureImage(merged.dockerImage!);
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

  const writable = merged.filesystemAccess === 'workspace-write';
  const overlays = writable ? (merged.readOnlyOverlays ?? []) : (merged.readOnlyOverlays ?? []).filter(overlay => overlay.kind === 'tmpfs-dir');
  const containerName = createSandboxContainerName();
  const dockerArgs = buildDockerRunArgs(command, merged, cwd, process.env, containerName);
  // Docker creates missing mount points on the host; remember which ones are ours to remove.
  const createdMountPoints = missingMountPointDirs(cwd, overlays);
  const cleanup = () => removeMountPointDirs(createdMountPoints);

  return new Promise((resolve) => {
    let timedOut = false;
    let aborted = false;
    const signal = options.signal;

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

    // Killing the docker CLI does not stop the container; kill it by its unique name.
    const stop = () => {
      child.kill('SIGKILL');
      killContainer(containerName);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      cleanup();
      resolve({
        success: exitCode === 0 && !timedOut && !aborted,
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
      signal?.removeEventListener('abort', onAbort);
      cleanup();
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
