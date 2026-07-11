/**
 * Agent 审计日志系统
 *
 * 记录所有工具执行、安全事件和权限检查，
 * 用于安全审计、问题排查和合规性检查。
 *
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getHostRootPlugin } from '@zhin.js/core';

// ── 审计事件类型 ──────────────────────────────────────────────────────

export type AuditEventType =
  | 'tool.execute'        // 工具执行
  | 'tool.denied'         // 工具被拒绝
  | 'tool.approval'       // 工具需要审批
  | 'exec.policy'         // 命令执行策略检查
  | 'file.access'         // 文件访问检查
  | 'security.violation'  // 安全违规
  | 'owner.confirm'       // Owner 确认
  | 'rate.limit'          // 速率限制
  | 'session.start'       // 会话开始
  | 'session.end';        // 会话结束

export type AuditEventSeverity = 'info' | 'warn' | 'error' | 'critical';

// ── 审计事件接口 ──────────────────────────────────────────────────────

export interface AuditEvent {
  /** 事件 ID */
  id: string;
  /** 事件类型 */
  type: AuditEventType;
  /** 严重程度 */
  severity: AuditEventSeverity;
  /** 时间戳 */
  timestamp: number;
  /** 会话 ID */
  sessionId?: string;
  /** 用户 ID */
  userId?: string;
  /** Endpoint ID */
  endpointId?: string;
  /** 平台 */
  platform?: string;
  /** 工具名称 */
  toolName?: string;
  /** 命令内容（脱敏） */
  command?: string;
  /** 文件路径 */
  filePath?: string;
  /** 事件描述 */
  message: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** 是否被阻止 */
  blocked?: boolean;
  /** 阻止原因 */
  blockReason?: string;
}

// ── 审计日志配置 ──────────────────────────────────────────────────────

export interface AuditLoggerConfig {
  /** 是否启用审计日志 */
  enabled: boolean;
  /** 日志文件路径 */
  logFile?: string;
  /** 最小记录级别 */
  minSeverity?: AuditEventSeverity;
  /** 是否记录敏感信息（如命令内容） */
  logSensitiveData?: boolean;
  /** 日志保留天数 */
  retentionDays?: number;
  /** 最大日志文件大小（MB） */
  maxFileSizeMB?: number;
}

const DEFAULT_CONFIG: AuditLoggerConfig = {
  enabled: true,
  minSeverity: 'info',
  logSensitiveData: false,
  retentionDays: 30,
  maxFileSizeMB: 100,
};

// ── 敏感信息脱敏 ──────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /credential/i,
  /auth/i,
];

/**
 * 脱敏命令中的敏感信息
 */
function sanitizeCommand(command: string): string {
  let sanitized = command;

  // 脱敏环境变量值
  sanitized = sanitized.replace(
    /([A-Za-z_][A-Za-z0-9_]*)=([^\s;|&]+)/g,
    (match, key, value) => {
      if (SENSITIVE_PATTERNS.some(p => p.test(key))) {
        return `${key}=***`;
      }
      return match;
    }
  );

  // 脱敏 URL 中的密码
  sanitized = sanitized.replace(
    /(https?:\/\/[^:]+:)[^@]+(@)/g,
    '$1***$2'
  );

  // 脱敏文件内容中的敏感数据
  sanitized = sanitized.replace(
    /(-[a-zA-Z]*p[a-zA-Z]*\s+)([^\s]+)/gi,
    '$1***'
  );

  return sanitized;
}

/**
 * 脱敏文件路径中的敏感信息
 */
function sanitizeFilePath(filePath: string): string {
  // 保留路径结构，但隐藏敏感目录内容
  const sensitiveDirs = ['.ssh', '.gnupg', '.aws', '.kube', '.docker'];
  let sanitized = filePath;

  for (const dir of sensitiveDirs) {
    if (sanitized.includes(dir)) {
      const parts = sanitized.split(dir);
      if (parts.length > 1) {
        sanitized = `${parts[0]}${dir}/***`;
      }
    }
  }

  return sanitized;
}

// ── 审计日志记录器 ────────────────────────────────────────────────────

export class AuditLogger {
  private config: AuditLoggerConfig;
  private logStream: fs.WriteStream | null = null;
  private eventCount = 0;
  private sessionEvents: AuditEvent[] = [];
  private static readonly MAX_SESSION_EVENTS = 5000;

  constructor(config: Partial<AuditLoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initLogFile();
  }

  private initLogFile(): void {
    if (!this.config.enabled || !this.config.logFile) return;

    try {
      const logDir = path.dirname(this.config.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      this.logStream = fs.createWriteStream(this.config.logFile, {
        flags: 'a',
        encoding: 'utf8',
      });

      this.logStream.on('error', (err) => {
        console.error('[AuditLogger] 写入日志文件失败:', err.message);
      });
    } catch (err) {
      console.error('[AuditLogger] 初始化日志文件失败:', err);
    }
  }

  /**
   * 生成事件 ID
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${++this.eventCount}`;
  }

  /**
   * 检查事件是否应该记录
   */
  private shouldLog(severity: AuditEventSeverity): boolean {
    if (!this.config.enabled) return false;

    const severityOrder: Record<AuditEventSeverity, number> = {
      info: 0,
      warn: 1,
      error: 2,
      critical: 3,
    };

    const minSeverity = this.config.minSeverity || 'info';
    return severityOrder[severity] >= severityOrder[minSeverity];
  }

  /**
   * 记录审计事件
   */
  log(event: Omit<AuditEvent, 'id' | 'timestamp'>): void {
    if (!this.shouldLog(event.severity)) return;

    const fullEvent: AuditEvent = {
      ...event,
      id: this.generateEventId(),
      timestamp: Date.now(),
    };

    // 脱敏处理
    if (!this.config.logSensitiveData) {
      if (fullEvent.command) {
        fullEvent.command = sanitizeCommand(fullEvent.command);
      }
      if (fullEvent.filePath) {
        fullEvent.filePath = sanitizeFilePath(fullEvent.filePath);
      }
    }

    // 添加到会话事件（FIFO 淘汰）
    this.sessionEvents.push(fullEvent);
    if (this.sessionEvents.length > AuditLogger.MAX_SESSION_EVENTS) {
      this.sessionEvents.splice(0, this.sessionEvents.length - AuditLogger.MAX_SESSION_EVENTS);
    }

    // 写入日志文件
    this.writeToFile(fullEvent);

    // 控制台输出（仅警告及以上级别）
    if (fullEvent.severity === 'warn' || fullEvent.severity === 'error' || fullEvent.severity === 'critical') {
      this.consoleLog(fullEvent);
    }
  }

  /**
   * 写入日志文件
   */
  private writeToFile(event: AuditEvent): void {
    if (!this.logStream) return;

    try {
      const logLine = JSON.stringify(event) + '\n';
      this.logStream.write(logLine);
    } catch (err) {
      console.error('[AuditLogger] 写入日志失败:', err);
    }
  }

  /**
   * 控制台输出
   */
  private consoleLog(event: AuditEvent): void {
    const prefix = `[Audit:${event.severity.toUpperCase()}]`;
    const message = `${prefix} ${event.type}: ${event.message}`;

    switch (event.severity) {
      case 'warn':
        console.warn(message);
        break;
      case 'error':
      case 'critical':
        console.error(message);
        break;
      default:
        console.info(message);
    }
  }

  /**
   * 记录工具执行
   */
  logToolExecution(toolName: string, args: Record<string, unknown>, result: unknown, duration: number): void {
    this.log({
      type: 'tool.execute',
      severity: 'info',
      toolName,
      message: `工具 ${toolName} 执行完成`,
      details: {
        args: this.config.logSensitiveData ? args : undefined,
        duration,
        success: true,
      },
    });
  }

  /**
   * 记录工具被拒绝
   */
  logToolDenied(toolName: string, reason: string, context?: Record<string, unknown>): void {
    this.log({
      type: 'tool.denied',
      severity: 'warn',
      toolName,
      message: `工具 ${toolName} 被拒绝: ${reason}`,
      blocked: true,
      blockReason: reason,
      details: context,
    });
  }

  /**
   * 记录命令执行策略检查
   */
  logExecPolicy(command: string, allowed: boolean, reason?: string): void {
    this.log({
      type: 'exec.policy',
      severity: allowed ? 'info' : 'warn',
      command,
      message: allowed ? `命令允许执行: ${command}` : `命令被拒绝: ${reason}`,
      blocked: !allowed,
      blockReason: reason,
    });
  }

  /**
   * 记录文件访问检查
   */
  logFileAccess(filePath: string, allowed: boolean, reason?: string): void {
    this.log({
      type: 'file.access',
      severity: allowed ? 'info' : 'warn',
      filePath,
      message: allowed ? `文件访问允许: ${filePath}` : `文件访问被拒绝: ${reason}`,
      blocked: !allowed,
      blockReason: reason,
    });
  }

  /**
   * 记录安全违规
   */
  logSecurityViolation(type: string, message: string, details?: Record<string, unknown>): void {
    this.log({
      type: 'security.violation',
      severity: 'error',
      message: `安全违规 [${type}]: ${message}`,
      blocked: true,
      details,
    });
  }

  /**
   * 记录 Owner 确认
   */
  logOwnerConfirm(toolName: string, approved: boolean, message?: string): void {
    this.log({
      type: 'owner.confirm',
      severity: 'info',
      toolName,
      message: `Owner ${approved ? '批准' : '拒绝'} 工具 ${toolName}`,
      details: { approved, message },
    });
  }

  /**
   * 记录速率限制
   */
  logRateLimit(userId: string, limit: number, current: number): void {
    this.log({
      type: 'rate.limit',
      severity: 'warn',
      userId,
      message: `用户 ${userId} 触发速率限制: ${current}/${limit}`,
      blocked: true,
      details: { limit, current },
    });
  }

  /**
   * 记录会话开始
   */
  logSessionStart(sessionId: string, userId?: string, endpointId?: string, platform?: string): void {
    this.log({
      type: 'session.start',
      severity: 'info',
      sessionId,
      userId,
      endpointId,
      platform,
      message: `会话开始: ${sessionId}`,
    });
  }

  /**
   * 记录会话结束
   */
  logSessionEnd(sessionId: string, duration: number, toolCount: number): void {
    this.log({
      type: 'session.end',
      severity: 'info',
      sessionId,
      message: `会话结束: ${sessionId} (${duration}ms, ${toolCount} 个工具调用)`,
      details: { duration, toolCount },
    });
  }

  /**
   * 获取当前会话的审计事件
   */
  getSessionEvents(): AuditEvent[] {
    return [...this.sessionEvents];
  }

  /**
   * 获取配置
   */
  getConfig(): AuditLoggerConfig {
    return { ...this.config };
  }

  /**
   * 获取审计统计
   */
  getStats(): {
    totalEvents: number;
    sessionEvents: number;
    blockedEvents: number;
    byType: Record<AuditEventType, number>;
    bySeverity: Record<AuditEventSeverity, number>;
  } {
    const byType = {} as Record<AuditEventType, number>;
    const bySeverity = {} as Record<AuditEventSeverity, number>;
    for (const t of ['tool.execute', 'tool.denied', 'tool.approval', 'exec.policy', 'file.access', 'security.violation', 'owner.confirm', 'rate.limit', 'session.start', 'session.end'] as AuditEventType[]) {
      byType[t] = 0;
    }
    for (const s of ['info', 'warn', 'error', 'critical'] as AuditEventSeverity[]) {
      bySeverity[s] = 0;
    }
    let blockedEvents = 0;

    for (const event of this.sessionEvents) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      if (event.blocked) blockedEvents++;
    }

    return {
      totalEvents: this.eventCount,
      sessionEvents: this.sessionEvents.length,
      blockedEvents,
      byType,
      bySeverity,
    };
  }

  /**
   * 清理会话事件
   */
  clearSessionEvents(): void {
    this.sessionEvents = [];
  }

  /**
   * 关闭日志流
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }
}

// ── 全局审计日志实例 ──────────────────────────────────────────────────

let globalAuditLogger: AuditLogger | null = null;

/**
 * 获取全局审计日志实例
 */
export function getAuditLogger(): AuditLogger {
  if (!globalAuditLogger) {
    const host = getHostRootPlugin();
    if (host) {
       
      const config = (host.inject('config') as any)?.getPrimary?.()?.ai?.agent?.audit;
      globalAuditLogger = new AuditLogger(config);
    } else {
      globalAuditLogger = new AuditLogger({ enabled: false });
    }
  }
  return globalAuditLogger;
}

/**
 * 初始化审计日志
 */
export function initAuditLogger(config: Partial<AuditLoggerConfig>): AuditLogger {
  if (globalAuditLogger) {
    globalAuditLogger.close();
  }
  globalAuditLogger = new AuditLogger(config);
  return globalAuditLogger;
}

/**
 * 关闭审计日志
 */
export function closeAuditLogger(): void {
  if (globalAuditLogger) {
    globalAuditLogger.close();
    globalAuditLogger = null;
  }
}
