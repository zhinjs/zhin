/**
 * 增强的沙箱环境
 *
 * 提供更细粒度的安全控制：
 * - 文件系统访问控制（白名单/黑名单）
 * - 网络隔离
 * - 资源监控
 * - 配置热更新
 */

import * as child_process from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

// ── 增强沙箱配置 ──────────────────────────────────────────────────────

export interface EnhancedSandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** 工作目录限制 */
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
  /** 文件系统访问控制 */
  fileSystem?: {
    /** 允许访问的路径白名单 */
    allowedPaths?: string[];
    /** 禁止访问的路径黑名单 */
    blockedPaths?: string[];
    /** 允许访问的文件扩展名 */
    allowedExtensions?: string[];
    /** 禁止访问的文件扩展名 */
    blockedExtensions?: string[];
    /** 是否允许创建临时文件 */
    allowTempFiles?: boolean;
    /** 是否允许删除文件 */
    allowDelete?: boolean;
  };
  /** 资源监控配置 */
  monitoring?: {
    /** 是否启用资源监控 */
    enabled?: boolean;
    /** 监控间隔（毫秒） */
    interval?: number;
    /** 是否记录资源使用 */
    logUsage?: boolean;
    /** 资源使用阈值 */
    thresholds?: {
      /** CPU 使用率阈值（百分比） */
      cpuPercent?: number;
      /** 内存使用阈值（MB） */
      memoryMB?: number;
      /** 执行时间阈值（毫秒） */
      executionTime?: number;
    };
  };
}

const DEFAULT_ENHANCED_CONFIG: EnhancedSandboxConfig = {
  enabled: true,
  timeout: 30000,
  maxMemoryMB: 512,
  maxCpuPercent: 50,
  maxOutputSize: 10 * 1024 * 1024,
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
  fileSystem: {
    allowedPaths: [],
    blockedPaths: [
      '/etc/shadow',
      '/etc/gshadow',
      '/etc/ssl/private',
      '/root/.ssh',
      '/root/.gnupg',
    ],
    allowedExtensions: [],
    blockedExtensions: ['.pem', '.key', '.p12', '.pfx'],
    allowTempFiles: true,
    allowDelete: false,
  },
  monitoring: {
    enabled: true,
    interval: 1000,
    logUsage: false,
    thresholds: {
      cpuPercent: 80,
      memoryMB: 400,
      executionTime: 25000,
    },
  },
};

// ── 资源使用统计 ──────────────────────────────────────────────────────

export interface ResourceUsage {
  /** CPU 使用时间（毫秒） */
  cpuTime: number;
  /** 内存使用（字节） */
  memoryUsage: number;
  /** 峰值内存使用（字节） */
  peakMemoryUsage: number;
  /** 执行时间（毫秒） */
  executionTime: number;
  /** I/O 读取字节数 */
  ioRead: number;
  /** I/O 写入字节数 */
  ioWrite: number;
}

// ── 增强沙箱执行结果 ──────────────────────────────────────────────────

export interface EnhancedSandboxResult {
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
  resourceUsage?: ResourceUsage;
  /** 资源使用警告 */
  warnings?: string[];
}

// ── 文件系统访问检查 ──────────────────────────────────────────────────

/**
 * 检查文件路径是否允许访问
 */
function checkFileAccess(
  filePath: string,
  config: EnhancedSandboxConfig,
): { allowed: boolean; reason?: string } {
  const fileSystem = config.fileSystem;
  if (!fileSystem) {
    return { allowed: true };
  }

  const resolvedPath = path.resolve(filePath);
  const ext = path.extname(resolvedPath);

  // 检查黑名单路径（优先级最高）
  if (fileSystem.blockedPaths) {
    for (const blockedPath of fileSystem.blockedPaths) {
      if (resolvedPath.startsWith(blockedPath)) {
        return {
          allowed: false,
          reason: `路径在黑名单中: ${blockedPath}`,
        };
      }
    }
  }

  // 检查文件扩展名黑名单
  if (fileSystem.blockedExtensions && fileSystem.blockedExtensions.length > 0) {
    if (fileSystem.blockedExtensions.includes(ext)) {
      return {
        allowed: false,
        reason: `文件扩展名在黑名单中: ${ext}`,
      };
    }
  }

  // 检查白名单路径（如果配置了白名单，且路径不在黑名单中）
  if (fileSystem.allowedPaths && fileSystem.allowedPaths.length > 0) {
    const isAllowed = fileSystem.allowedPaths.some(allowedPath =>
      resolvedPath.startsWith(allowedPath)
    );
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `路径不在白名单中: ${resolvedPath}`,
      };
    }
  }

  // 检查文件扩展名白名单（如果配置了白名单）
  if (fileSystem.allowedExtensions && fileSystem.allowedExtensions.length > 0) {
    if (!fileSystem.allowedExtensions.includes(ext)) {
      return {
        allowed: false,
        reason: `文件扩展名不在白名单中: ${ext}`,
      };
    }
  }

  return { allowed: true };
}

/**
 * 检查命令是否尝试删除文件
 */
function checkDeleteOperation(
  command: string,
  config: EnhancedSandboxConfig,
): { allowed: boolean; reason?: string } {
  const fileSystem = config.fileSystem;
  if (!fileSystem || fileSystem.allowDelete) {
    return { allowed: true };
  }

  // 检查删除命令
  const deletePatterns = [
    /\brm\s+/,
    /\brmdir\s+/,
    /\bunlink\s+/,
    /\bshred\s+/,
  ];

  for (const pattern of deletePatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: '沙箱内禁止删除文件',
      };
    }
  }

  return { allowed: true };
}

// ── 网络访问检查 ──────────────────────────────────────────────────────

/**
 * 检查命令是否尝试访问网络
 */
function checkNetworkAccess(
  command: string,
  config: EnhancedSandboxConfig,
): { allowed: boolean; reason?: string } {
  if (config.enableNetwork) {
    return { allowed: true };
  }

  // 检查网络命令
  const networkPatterns = [
    /\bcurl\s+/,
    /\bwget\s+/,
    /\bnc\s+/,
    /\bnetcat\s+/,
    /\bssh\s+/,
    /\bscp\s+/,
    /\brsync\s+/,
    /\bping\s+/,
    /\btraceroute\s+/,
    /\bnmap\s+/,
    /\bhttp\s+/,
    /\bhttps\s+/,
  ];

  for (const pattern of networkPatterns) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: '沙箱内禁止网络访问',
      };
    }
  }

  return { allowed: true };
}

// ── 命令验证 ──────────────────────────────────────────────────────────

/**
 * 验证命令是否在沙箱允许范围内
 */
function validateEnhancedCommand(
  command: string,
  config: EnhancedSandboxConfig,
): { valid: boolean; reason?: string } {
  // 检查是否尝试更改目录
  if (/\bcd\s/.test(command)) {
    return { valid: false, reason: '沙箱内禁止使用 cd 命令' };
  }

  // 检查是否尝试下载恶意内容（优先级最高）
  const dangerousPatterns = [
    /curl.*\|\s*sh/,
    /wget.*\|\s*sh/,
    /curl.*&&.*\./,
    /wget.*&&.*\./,
    /eval\s*\(/,
    /exec\s*\(/,
    /child_process/,
    /spawn\s*\(/,
    /fork\s*\(/,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `沙箱内禁止执行危险命令模式: ${pattern.source}`,
      };
    }
  }

  // 检查网络访问
  const networkResult = checkNetworkAccess(command, config);
  if (!networkResult.allowed) {
    return {
      valid: false,
      reason: networkResult.reason,
    };
  }

  // 检查删除操作
  const deleteResult = checkDeleteOperation(command, config);
  if (!deleteResult.allowed) {
    return {
      valid: false,
      reason: deleteResult.reason,
    };
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
        '/etc/',
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

  // 检查文件访问权限（从命令中提取文件路径）
  const filePathPattern = /(?:^|\s|;|&&|\|\|)([^\s;|&`"'{}[\]()]+\.[a-zA-Z]+)(?:\s|$|;|&&|\|\|)/g;
  let fileMatch;
  while ((fileMatch = filePathPattern.exec(command)) !== null) {
    const filePath = fileMatch[1].trim();
    // 只检查看起来像文件路径的字符串
    if (filePath.includes('/') || filePath.includes('.')) {
      const fileAccessResult = checkFileAccess(filePath, config);
      if (!fileAccessResult.allowed) {
        return {
          valid: false,
          reason: fileAccessResult.reason,
        };
      }
    }
  }

  return { valid: true };
}

// ── 环境变量清理 ──────────────────────────────────────────────────────

/**
 * 清理环境变量
 */
function cleanEnhancedEnvironment(config: EnhancedSandboxConfig): Record<string, string> {
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
      if (config.blockedEnvVars && config.blockedEnvVars.includes(key)) {
        continue;
      }
      cleanEnv[key] = value;
    }
  }

  return cleanEnv;
}

// ── 资源监控 ──────────────────────────────────────────────────────────

/**
 * 资源监控器
 */
class ResourceMonitor {
  private startTime: number;
  private intervalId: NodeJS.Timeout | null = null;
  private peakMemory: number = 0;
  private warnings: string[] = [];
  private config: EnhancedSandboxConfig;

  constructor(config: EnhancedSandboxConfig) {
    this.config = config;
    this.startTime = Date.now();
  }

  start(): void {
    if (!this.config.monitoring?.enabled) {
      return;
    }

    const interval = this.config.monitoring.interval || 1000;

    this.intervalId = setInterval(() => {
      this.checkResources();
    }, interval);
  }

  stop(): ResourceUsage {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    const duration = Date.now() - this.startTime;
    const memoryUsage = process.memoryUsage();

    return {
      cpuTime: duration, // 简化：使用实际时间代替 CPU 时间
      memoryUsage: memoryUsage.heapUsed,
      peakMemoryUsage: this.peakMemory,
      executionTime: duration,
      ioRead: 0, // 需要平台特定实现
      ioWrite: 0,
    };
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  private checkResources(): void {
    const memoryUsage = process.memoryUsage();
    const currentMemory = memoryUsage.heapUsed;

    // 更新峰值内存
    if (currentMemory > this.peakMemory) {
      this.peakMemory = currentMemory;
    }

    // 检查内存阈值
    const thresholds = this.config.monitoring?.thresholds;
    if (thresholds?.memoryMB) {
      const memoryMB = currentMemory / (1024 * 1024);
      if (memoryMB > thresholds.memoryMB) {
        this.warnings.push(`内存使用超过阈值: ${memoryMB.toFixed(2)}MB > ${thresholds.memoryMB}MB`);
      }
    }

    // 检查执行时间阈值
    if (thresholds?.executionTime) {
      const elapsed = Date.now() - this.startTime;
      if (elapsed > thresholds.executionTime) {
        this.warnings.push(`执行时间超过阈值: ${elapsed}ms > ${thresholds.executionTime}ms`);
      }
    }
  }
}

// ── 增强沙箱类 ────────────────────────────────────────────────────────

export class EnhancedSandbox {
  private config: EnhancedSandboxConfig;
  private configListeners: Array<(config: EnhancedSandboxConfig) => void> = [];

  constructor(config: Partial<EnhancedSandboxConfig> = {}) {
    this.config = { ...DEFAULT_ENHANCED_CONFIG, ...config };
  }

  /**
   * 在沙箱中执行命令
   */
  async execute(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<EnhancedSandboxResult> {
    if (!this.config.enabled) {
      return this.executeUnsafe(command, options);
    }

    const startTime = Date.now();
    const warnings: string[] = [];

    // 验证命令
    const validation = validateEnhancedCommand(command, this.config);
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
    const cleanEnv = cleanEnhancedEnvironment(this.config);

    // 合并用户提供的环境变量
    if (options?.env) {
      for (const [key, value] of Object.entries(options.env)) {
        if (this.config.blockedEnvVars && this.config.blockedEnvVars.includes(key)) {
          continue;
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

    // 创建资源监控器
    const monitor = new ResourceMonitor(this.config);
    monitor.start();

    // 执行命令
    return new Promise((resolve) => {
      const timeout = options?.timeout || this.config.timeout || 30000;
      let timedOut = false;

      const child = child_process.spawn('bash', ['-c', command], {
        cwd,
        env: cleanEnv,
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
        const resourceUsage = monitor.stop();
        const monitorWarnings = monitor.getWarnings();
        warnings.push(...monitorWarnings);

        const stdout = stdoutChunks.join('').slice(0, maxOutput);
        const stderr = stderrChunks.join('').slice(0, maxOutput);

        resolve({
          success: exitCode === 0 && !timedOut,
          stdout,
          stderr,
          exitCode,
          duration: Date.now() - startTime,
          timedOut,
          blocked: false,
          resourceUsage,
          warnings: warnings.length > 0 ? warnings : undefined,
        });
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        monitor.stop();

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
   * 不安全的命令执行
   */
  private async executeUnsafe(command: string, options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }): Promise<EnhancedSandboxResult> {
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
   * 更新配置（热更新）
   */
  updateConfig(config: Partial<EnhancedSandboxConfig>): void {
    this.config = { ...this.config, ...config };
    this.notifyConfigListeners();
  }

  /**
   * 获取配置
   */
  getConfig(): EnhancedSandboxConfig {
    return { ...this.config };
  }

  /**
   * 添加配置变更监听器
   */
  onConfigChange(listener: (config: EnhancedSandboxConfig) => void): () => void {
    this.configListeners.push(listener);
    return () => {
      const index = this.configListeners.indexOf(listener);
      if (index > -1) {
        this.configListeners.splice(index, 1);
      }
    };
  }

  /**
   * 通知配置变更监听器
   */
  private notifyConfigListeners(): void {
    for (const listener of this.configListeners) {
      try {
        listener(this.config);
      } catch (error) {
        console.error('[EnhancedSandbox] Config listener error:', error);
      }
    }
  }

  /**
   * 检查文件访问权限
   */
  checkFileAccess(filePath: string): { allowed: boolean; reason?: string } {
    return checkFileAccess(filePath, this.config);
  }

  /**
   * 检查命令安全性
   */
  checkCommandSafety(command: string): { safe: boolean; reason?: string } {
    const validation = validateEnhancedCommand(command, this.config);
    return {
      safe: validation.valid,
      reason: validation.reason,
    };
  }

  dispose(): void {
    this.configListeners.length = 0;
  }
}

// ── 全局实例 ──────────────────────────────────────────────────────────

let globalEnhancedSandbox: EnhancedSandbox | null = null;

/**
 * 获取全局增强沙箱实例
 */
export function getEnhancedSandbox(): EnhancedSandbox {
  if (!globalEnhancedSandbox) {
    globalEnhancedSandbox = new EnhancedSandbox();
  }
  return globalEnhancedSandbox;
}

/**
 * 初始化增强沙箱
 */
export function initEnhancedSandbox(config: Partial<EnhancedSandboxConfig>): EnhancedSandbox {
  globalEnhancedSandbox = new EnhancedSandbox(config);
  return globalEnhancedSandbox;
}

/** 重置全局增强沙箱（用于测试隔离） */
export function resetEnhancedSandbox(): void {
  globalEnhancedSandbox = null;
}

/**
 * 在增强沙箱中执行命令
 */
export async function executeInEnhancedSandbox(
  command: string,
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  },
): Promise<EnhancedSandboxResult> {
  return getEnhancedSandbox().execute(command, options);
}
