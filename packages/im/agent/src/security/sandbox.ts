/**
 * Agent 沙箱环境
 *
 * 提供进程级隔离和资源限制。
 *
 * 功能：
 * - 进程隔离（子进程执行）
 * - 资源限制（CPU、内存、时间）
 * - 文件系统隔离（工作目录限制）
 * - 环境变量清理
 * - 网络隔离（可选）
 */

import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// ── 资源限制包装 ────────────────────────────────────────────────────

/**
 * 用 ulimit/timeout/nice 包装命令，强制施加资源限制。
 * 仅在 POSIX 系统（Linux/macOS）生效。
 */
function wrapCommandWithLimits(
  command: string,
  config: { maxMemoryMB?: number; timeout?: number; maxCpuPercent?: number },
): string {
  if (process.platform === 'win32') return command;

  const parts: string[] = [];

  // 内存限制：ulimit -v <KB>（虚拟地址空间）— 仅 Linux 支持
  if (config.maxMemoryMB && config.maxMemoryMB > 0 && process.platform === 'linux') {
    const kb = config.maxMemoryMB * 1024;
    parts.push(`ulimit -v ${kb} 2>/dev/null || true`);
  }

  // CPU 时间限制：ulimit -t <seconds> — 仅 Linux 支持
  if (config.timeout && config.timeout > 0 && process.platform === 'linux') {
    const cpuSeconds = Math.ceil(config.timeout / 1000) * 2;
    parts.push(`ulimit -t ${cpuSeconds} 2>/dev/null || true`);
  }

  // 最大文件写入大小：ulimit -f <blocks>（10MB = 20480 blocks of 512B）
  parts.push('ulimit -f 20480 2>/dev/null || true');

  // 最大进程数：ulimit -u 64
  parts.push('ulimit -u 64 2>/dev/null || true');

  if (parts.length === 0) return command;

  // 用分号连接，ulimit 失败也继续执行
  const ulimitChain = parts.join(' ; ');
  return `${ulimitChain} ; exec bash -c ${JSON.stringify(command)}`;
}

/**
 * 从 /proc/<pid>/status 读取子进程资源使用（仅 Linux）
 */
function readChildResourceUsage(pid: number): { memoryKB: number } | null {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const vmRss = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return {
      memoryKB: vmRss ? parseInt(vmRss[1], 10) : 0,
    };
  } catch {
    return null; // macOS 或进程已退出
  }
}

/** 安全杀死进程组（detached 模式下杀整棵树） */
function killProcessGroup(child: child_process.ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  try {
    if (child.pid) {
      process.kill(-child.pid, signal); // 负 PID = 杀整个进程组
    }
  } catch {
    // 进程已退出
  }
}

// ── 沙箱配置 ──────────────────────────────────────────────────────────

export interface SandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 工作目录限制（命令只能在此目录下执行） */
  workingDirectory?: string;
  /** 最大执行时间（毫秒） */
  timeout?: number;
  /** 最大内存使用（MB） */
  maxMemoryMB?: number;
  /** 最大 CPU 使用率（百分比） */
  maxCpuPercent?: number;
  /** 最大输出大小（字节） */
  maxOutputSize?: number;
  /** 允许的环境变量 */
  allowedEnvVars?: string[];
  /** 禁止的环境变量 */
  blockedEnvVars?: string[];
  /** 是否保留 HOME 目录 */
  preserveHome?: boolean;
  /** 是否保留 PATH */
  preservePath?: boolean;
  /** 额外的环境变量 */
  extraEnvVars?: Record<string, string>;
  /** 是否启用网络（默认 false） */
  enableNetwork?: boolean;
  /** 允许的域名（如果启用网络） */
  allowedDomains?: string[];
  /** 是否使用 Docker 容器隔离（默认 'auto'：检测到 Docker 就用） */
  useDocker?: 'auto' | 'always' | 'never';
  /** Docker 镜像（默认 node:20-alpine） */
  dockerImage?: string;
}

const DEFAULT_CONFIG: SandboxConfig = {
  enabled: true,
  timeout: 30000,           // 30 秒
  maxMemoryMB: 512,         // 512 MB
  maxCpuPercent: 50,        // 50%
  maxOutputSize: 10 * 1024 * 1024,  // 10 MB
  preserveHome: true,
  preservePath: true,
  enableNetwork: false,
  allowedEnvVars: [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'NODE_ENV',
    'npm_config_cache',
    'npm_config_prefix',
  ],
  blockedEnvVars: [
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_CLIENT_ID',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'KUBECONFIG',
    'DOCKER_HOST',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
    'SSH_AUTH_SOCK',
    'SSH_AGENT_PID',
    'GPG_AGENT_INFO',
    'XDG_RUNTIME_DIR',
  ],
};

// ── 沙箱执行结果 ──────────────────────────────────────────────────────

export interface SandboxResult {
  /** 是否成功 */
  success: boolean;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 退出码 */
  exitCode: number | null;
  /** 执行时间（毫秒） */
  duration: number;
  /** 是否超时 */
  timedOut: boolean;
  /** 是否被沙箱阻止 */
  blocked: boolean;
  /** 阻止原因 */
  blockReason?: string;
  /** 资源使用情况 */
  resourceUsage?: {
    cpuTime: number;
    memoryUsage: number;
  };
}

// ── 环境变量清理 ──────────────────────────────────────────────────────

/**
 * 清理环境变量，移除敏感变量并只保留允许的变量
 */
function cleanEnvironment(config: SandboxConfig): Record<string, string> {
  const cleanEnv: Record<string, string> = {};

  // 保留允许的环境变量
  if (config.allowedEnvVars) {
    for (const varName of config.allowedEnvVars) {
      if (process.env[varName]) {
        cleanEnv[varName] = process.env[varName]!;
      }
    }
  }

  // 移除被阻止的环境变量
  if (config.blockedEnvVars) {
    for (const varName of config.blockedEnvVars) {
      delete cleanEnv[varName];
    }
  }

  // 保留 HOME 目录
  if (config.preserveHome) {
    cleanEnv.HOME = os.homedir();
  }

  // 保留 PATH
  if (config.preservePath) {
    cleanEnv.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';
  }

  // 添加额外的环境变量（但要检查是否在阻止列表中）
  if (config.extraEnvVars) {
    for (const [key, value] of Object.entries(config.extraEnvVars)) {
      // 检查是否在阻止列表中
      if (config.blockedEnvVars && config.blockedEnvVars.includes(key)) {
        continue;  // 跳过被阻止的变量
      }
      cleanEnv[key] = value;
    }
  }

  return cleanEnv;
}

// ── 网络命令检测 ────────────────────────────────────────────────────

export { NETWORK_COMMAND_PATTERNS, checkNetworkCommandAccess, extractUrlsFromCommand } from './network-policy.js';
import { checkNetworkCommandAccess, extractUrlsFromCommand } from './network-policy.js';

/**
 * 检查网络命令访问权限（委托给统一 network-policy）
 */
function checkNetworkCommand(
  command: string,
  config: SandboxConfig,
): { allowed: boolean; reason?: string } {
  return checkNetworkCommandAccess(command, {
    enableNetwork: config.enableNetwork,
    allowedDomains: config.allowedDomains,
  });
}

// ── 命令验证 ──────────────────────────────────────────────────────────

function matchDangerousSandboxCommand(command: string): string | undefined {
  const lower = command.toLowerCase();
  if (
    (lower.includes('curl') || lower.includes('wget')) &&
    lower.includes('|') &&
    /\bsh\b/.test(lower)
  ) {
    return '沙箱内禁止执行危险命令模式: curl|sh / wget|sh 类管道';
  }
  if (
    (lower.includes('curl') || lower.includes('wget')) &&
    lower.includes('&&') &&
    lower.includes('./')
  ) {
    return '沙箱内禁止执行危险命令模式: curl/wget 下载后直接执行';
  }
  if (/\b(?:rm|rmdir)\b/.test(lower) && lower.includes('node_modules')) {
    return '沙箱内禁止执行危险命令模式: 删除 node_modules';
  }
  if (lower.includes('find') && lower.includes('node_modules') && lower.includes('-delete')) {
    return '沙箱内禁止执行危险命令模式: find -delete node_modules';
  }
  if (lower.includes('eval(') || lower.includes('exec(')) {
    return '沙箱内禁止执行危险命令模式: eval/exec';
  }
  if (lower.includes('child_process') || lower.includes('spawn(') || lower.includes('fork(')) {
    return '沙箱内禁止执行危险命令模式: 进程注入相关调用';
  }
  return undefined;
}

/**
 * 验证命令是否在沙箱允许范围内
 */
function validateCommand(command: string, config: SandboxConfig): { valid: boolean; reason?: string } {
  // 检查是否尝试更改目录
  if (/\bcd\s/.test(command)) {
    return { valid: false, reason: '沙箱内禁止使用 cd 命令' };
  }

  // 检查是否尝试访问沙箱外的文件
  if (config.workingDirectory) {
    // 检查绝对路径访问
    const absolutePathPattern = /(?:^|\s|;|&&|\|\|)(\/[^\s;|&`"'{}[\]()]+?)(?:\s|$|;|&&|\|\|)/g;
    let match;
    while ((match = absolutePathPattern.exec(command)) !== null) {
      const filePath = match[1].trim();
      // 检查是否是沙箱内的路径
      const allowedPaths = [
        config.workingDirectory,
        '/dev/null',
        '/tmp/',
        '/usr/',
        '/bin/',
        '/sbin/',
        '/etc/',  // 允许读取系统配置
        '/var/',
        '/proc/',
      ];

      const isAllowed = allowedPaths.some(allowed => filePath.startsWith(allowed));
      if (!isAllowed) {
        return {
          valid: false,
          reason: `沙箱内禁止访问工作目录外的文件: ${filePath}`,
        };
      }
    }

    // 检查父目录遍历
    if (/\.\.\//.test(command)) {
      return {
        valid: false,
        reason: '沙箱内禁止使用父目录遍历（../）',
      };
    }
  }

  const blocked = matchDangerousSandboxCommand(command);
  if (blocked) {
    return { valid: false, reason: blocked };
  }

  // 网络命令检查
  const networkCheck = checkNetworkCommand(command, config);
  if (!networkCheck.allowed) {
    return { valid: false, reason: networkCheck.reason };
  }

  return { valid: true };
}

// ── 沙箱执行器 ────────────────────────────────────────────────────────

export class Sandbox {
  private config: SandboxConfig;
  private _dockerAvailable: boolean | null = null; // 缓存检测结果

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** 是否应该使用 Docker 沙箱 */
  private shouldUseDocker(): boolean {
    const mode = this.config.useDocker || 'auto';
    if (mode === 'never') return false;
    if (mode === 'always') return true;

    // auto 模式：检测 Docker 是否可用
    if (this._dockerAvailable === null) {
      try {
        const { isDockerAvailable } = require('./sandbox-docker.js');
        this._dockerAvailable = isDockerAvailable();
      } catch {
        this._dockerAvailable = false;
      }
    }
    return this._dockerAvailable ?? false;
  }

  /**
   * 在沙箱中执行命令
   */
  async execute(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<SandboxResult> {
    if (!this.config.enabled) {
      return this.executeUnsafe(command, options);
    }

    const startTime = Date.now();

    // 验证命令（无论使用哪种沙箱都先验证）
    const validation = validateCommand(command, this.config);
    if (!validation.valid) {
      return {
        success: false,
        stdout: '',
        stderr: validation.reason!,
        exitCode: 1,
        duration: Date.now() - startTime,
        timedOut: false,
        blocked: true,
        blockReason: validation.reason,
      };
    }

    // 优先使用 Docker 容器隔离
    if (this.shouldUseDocker()) {
      try {
        const { executeInDocker } = require('./sandbox-docker.js');
        return executeInDocker(command, {
          ...this.config,
          workingDirectory: options?.cwd || this.config.workingDirectory,
          timeout: options?.timeout || this.config.timeout,
        });
      } catch (e) {
        // Docker 执行失败，降级到软沙箱
      }
    }

    // 降级：软沙箱（ulimit 包装 + 进程组隔离）
    return this.executeSoft(command, options);
  }

  /** 软沙箱执行（ulimit 包装 + detached 进程组 + /proc 资源监控） */
  private async executeSoft(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<SandboxResult> {
    const startTime = Date.now();

    // 清理环境变量
    const cleanEnv = cleanEnvironment(this.config);

    // 合并用户提供的环境变量（但要检查是否在阻止列表中）
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        // 检查是否在阻止列表中
        if (this.config.blockedEnvVars && this.config.blockedEnvVars.includes(key)) {
          continue;  // 跳过被阻止的变量
        }
        cleanEnv[key] = value;
      }
    }

    // 设置工作目录
    const cwd = options?.cwd || this.config.workingDirectory || process.cwd();

    // 确保工作目录存在
    if (!fs.existsSync(cwd)) {
      fs.mkdirSync(cwd, { recursive: true });
    }

    // 执行命令（用 ulimit 包装资源限制）
    return new Promise((resolve) => {
      const timeout = options?.timeout || this.config.timeout || 30000;
      let timedOut = false;
      let killed = false;

      // 包装命令：ulimit 内存/CPU/文件/进程限制
      const wrappedCommand = wrapCommandWithLimits(command, {
        maxMemoryMB: this.config.maxMemoryMB,
        timeout,
        maxCpuPercent: this.config.maxCpuPercent,
      });

      const child = child_process.spawn('bash', ['-c', wrappedCommand], {
        cwd,
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // 新进程组，便于整棵进程树 kill
      });

      const maxOutput = this.config.maxOutputSize || 10 * 1024 * 1024;
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

      // 资源监控（每 500ms 采样一次子进程内存）
      let peakMemoryKB = 0;
      const resourceTimer = setInterval(() => {
        if (child.pid) {
          const usage = readChildResourceUsage(child.pid);
          if (usage && usage.memoryKB > peakMemoryKB) {
            peakMemoryKB = usage.memoryKB;
          }
        }
      }, 500);
      resourceTimer.unref?.();

      // 超时处理 — 杀整个进程组
      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        killProcessGroup(child, 'SIGKILL');
      }, timeout);

      child.on('close', (exitCode) => {
        clearTimeout(timer);
        clearInterval(resourceTimer);

        // 超时后补一次资源采样
        if (child.pid && peakMemoryKB === 0) {
          const usage = readChildResourceUsage(child.pid);
          if (usage) peakMemoryKB = usage.memoryKB;
        }

        const stdout = stdoutChunks.join('').slice(0, maxOutput);
        const stderr = stderrChunks.join('').slice(0, maxOutput);
        const duration = Date.now() - startTime;

        resolve({
          success: exitCode === 0 && !timedOut,
          stdout,
          stderr,
          exitCode,
          duration,
          timedOut,
          blocked: false,
          resourceUsage: {
            cpuTime: 0,
            memoryUsage: peakMemoryKB * 1024, // 转为 bytes
          },
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        clearInterval(resourceTimer);

        resolve({
          success: false,
          stdout: stdoutChunks.join(''),
          stderr: error.message,
          exitCode: 1,
          duration: Date.now() - startTime,
          timedOut: false,
          blocked: false,
        });
      });
    });
  }

  private async executeUnsafe(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<SandboxResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timeout = options?.timeout || 30000;
      let timedOut = false;

      // 即使在 unsafe 模式也要过滤敏感环境变量
      const cleanEnv = { ...process.env };
      if (this.config.blockedEnvVars) {
        for (const key of this.config.blockedEnvVars) {
          delete cleanEnv[key];
        }
      }

      const child = child_process.spawn('bash', ['-c', command], {
        cwd: options?.cwd || process.cwd(),
        env: { ...cleanEnv, ...options?.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      });

      const maxOutput = this.config.maxOutputSize || 10 * 1024 * 1024;
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
          stderr: error.message,
          exitCode: 1,
          duration: Date.now() - startTime,
          timedOut: false,
          blocked: false,
        });
      });
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   */
  getConfig(): SandboxConfig {
    return { ...this.config };
  }
}

// ── 全局沙箱实例 ──────────────────────────────────────────────────────

let globalSandbox: Sandbox | null = null;

/**
 * 获取全局沙箱实例
 */
export function getSandbox(): Sandbox {
  if (!globalSandbox) {
    globalSandbox = new Sandbox();
  }
  return globalSandbox;
}

/**
 * 初始化沙箱
 */
export function initSandbox(config: Partial<SandboxConfig>): Sandbox {
  globalSandbox = new Sandbox(config);
  return globalSandbox;
}

/** 重置全局沙箱（用于测试隔离） */
export function resetSandbox(): void {
  globalSandbox = null;
}

/**
 * 在沙箱中执行命令
 */
export async function executeInSandbox(command: string, options?: {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}): Promise<SandboxResult> {
  return getSandbox().execute(command, options);
}
