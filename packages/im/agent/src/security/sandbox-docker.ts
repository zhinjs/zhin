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

/** Result of one docker CLI command: exit code and (bounded) stderr; `null` when it could not run or timed out. */
export type DockerCommandResult = Readonly<{ code: number | null; stderr: string }> | null;

/**
 * The docker CLI as `executeInDocker` uses it. Injectable so the stop / confirm protocol can be
 * tested without Docker.
 */
export interface DockerCli {
  /** Starts `docker run …` (the foreground CLI process). */
  spawnRun(args: readonly string[]): child_process.ChildProcess;
  /** Runs a short docker command to completion. */
  run(args: readonly string[], timeoutMs: number): Promise<DockerCommandResult>;
}

function runDockerCommand(args: readonly string[], timeoutMs: number): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = '';
    const finish = (value: DockerCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    let child: child_process.ChildProcess;
    try {
      child = child_process.spawn('docker', [...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, timeoutMs);
    child.stderr?.on('data', (chunk) => { if (stderr.length < 4096) stderr += String(chunk); });
    child.on('error', () => finish(null));
    child.on('close', code => finish({ code, stderr }));
  });
}

const SYSTEM_DOCKER: DockerCli = {
  spawnRun: args => child_process.spawn('docker', [...args], { stdio: ['pipe', 'pipe', 'pipe'] }),
  run: runDockerCommand,
};

const NO_SUCH_CONTAINER = /no such (?:container|object)/iu;

/** Bounds of the stop protocol: the synchronous confirmation, then background retries. */
export const CONTAINER_STOP_CONFIRM_MS = 10_000;
export const CONTAINER_STOP_RETRY_MS = 5_000;
export const CONTAINER_STOP_RETRIES = 24;

/**
 * Removes the container and confirms it is gone: `docker rm -f` (kill + remove), then
 * `docker inspect` must answer "no such container". Only that answer counts as confirmation — a
 * failing or missing docker CLI does not.
 */
export async function stopContainer(
  docker: Pick<DockerCli, 'run'>,
  containerName: string,
  timeoutMs: number = CONTAINER_STOP_CONFIRM_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (let attempt = 0; ; attempt += 1) {
    const left = Math.max(1, deadline - Date.now());
    await docker.run(['rm', '-f', containerName], left);
    const inspect = await docker.run(['inspect', '--format', '{{.State.Status}}', containerName], Math.max(1, deadline - Date.now()));
    if (inspect && inspect.code !== 0 && NO_SUCH_CONTAINER.test(inspect.stderr)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(200 * (attempt + 1), 1_000)));
  }
}

/** Keeps retrying {@link stopContainer} in the background; resolves once confirmed or after the last retry. */
function keepStopping(docker: Pick<DockerCli, 'run'>, containerName: string): Promise<boolean> {
  return (async () => {
    for (let retry = 0; retry < CONTAINER_STOP_RETRIES; retry += 1) {
      await new Promise(resolve => setTimeout(resolve, CONTAINER_STOP_RETRY_MS));
      if (await stopContainer(docker, containerName)) return true;
    }
    return false;
  })();
}

/** Unique per-run container name so a timeout or cancel kills exactly this container. */
export function createSandboxContainerName(): string {
  return `zhin-sandbox-${randomUUID()}`;
}

export function buildDockerKillArgs(containerName: string): string[] {
  return ['kill', containerName];
}

/**
 * Immediate `docker kill <name>` when a stop is requested; {@link stopContainer} then confirms the
 * container is gone before the run settles.
 */
function killContainer(docker: Pick<DockerCli, 'run'>, containerName: string): void {
  void docker.run(buildDockerKillArgs(containerName), CONTAINER_STOP_CONFIRM_MS).catch(() => null);
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
  options: { signal?: AbortSignal; docker?: DockerCli; stopConfirmMs?: number } = {},
): Promise<SandboxResult> {
  const merged: DockerSandboxConfig = { ...DEFAULT_DOCKER_CONFIG, ...config };
  const startTime = Date.now();
  const docker = options.docker ?? SYSTEM_DOCKER;

  // 确保镜像存在
  const imageCheck = await ensureImage(
    merged.dockerImage!,
    options.docker ? async (args, timeoutMs) => (await docker.run(args, timeoutMs))?.code === 0 : undefined,
  );
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

    const child = docker.spawnRun(dockerArgs);

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

    // Killing the docker CLI does not stop the container; kill it by its unique name. The run
    // only settles once that container is confirmed gone (or the bounded wait gave up): callers
    // inspect the workspace afterwards, and a live container could still be writing to it.
    let stopRequested = false;
    const stop = () => {
      stopRequested = true;
      child.kill('SIGKILL');
      killContainer(docker, containerName);
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
      void (async () => {
        const confirmed = stopRequested ? await stopContainer(docker, containerName, options.stopConfirmMs) : undefined;
        cleanup();
        resolve({
          success: exitCode === 0 && !timedOut && !aborted,
          stdout: stdoutChunks.join('').slice(0, maxOutput),
          stderr: stderrChunks.join('').slice(0, maxOutput),
          exitCode,
          duration: Date.now() - startTime,
          timedOut,
          blocked: false,
          ...(confirmed === undefined ? {} : { containerStopConfirmed: confirmed }),
          ...(confirmed === false ? { containerStopped: keepStopping(docker, containerName) } : {}),
        });
      })();
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
