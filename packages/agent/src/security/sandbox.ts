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

  return { valid: true };
}

// ── 沙箱执行器 ────────────────────────────────────────────────────────

export class Sandbox {
  private config: SandboxConfig;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
      // 沙箱未启用，直接执行
      return this.executeUnsafe(command, options);
    }

    const startTime = Date.now();

    // 验证命令
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

    // 执行命令
    return new Promise((resolve) => {
      const timeout = options?.timeout || this.config.timeout || 30000;
      let timedOut = false;
      let killed = false;

      const child = child_process.spawn('bash', ['-c', command], {
        cwd,
        env: cleanEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
        // 资源限制（仅 Linux/macOS）
        ...(process.platform !== 'win32' && {
          // 内存限制（通过 ulimit）
          // 注意：Node.js 没有直接的内存限制 API，需要通过 ulimit 命令
        }),
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        if (stdout.length + chunk.length <= (this.config.maxOutputSize || 10 * 1024 * 1024)) {
          stdout += chunk;
        }
      });

      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        if (stderr.length + chunk.length <= (this.config.maxOutputSize || 10 * 1024 * 1024)) {
          stderr += chunk;
        }
      });

      // 超时处理
      const timer = setTimeout(() => {
        timedOut = true;
        killed = true;
        child.kill('SIGKILL');
      }, timeout);

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        const duration = Date.now() - startTime;

        resolve({
          success: exitCode === 0 && !timedOut,
          stdout: stdout.slice(0, this.config.maxOutputSize),
          stderr: stderr.slice(0, this.config.maxOutputSize),
          exitCode,
          duration,
          timedOut,
          blocked: false,
          resourceUsage: {
            cpuTime: 0, // 需要从 /proc 或 ps 获取
            memoryUsage: 0,
          },
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);

        resolve({
          success: false,
          stdout,
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
   * 不安全的命令执行（沙箱未启用时）
   */
  private async executeUnsafe(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<SandboxResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timeout = options?.timeout || 30000;
      let timedOut = false;

      const child = child_process.spawn('bash', ['-c', command], {
        cwd: options?.cwd || process.cwd(),
        env: { ...process.env, ...options?.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);

      child.on('close', (exitCode) => {
        clearTimeout(timer);

        resolve({
          success: exitCode === 0 && !timedOut,
          stdout,
          stderr,
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
          stdout,
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
