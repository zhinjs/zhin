import { addTransport, type LogTransport } from '@zhin.js/logger';
import {
  defineSystemLogTable,
  insertSystemLogRow,
  SYSTEM_LOG_TABLE,
  type DatabaseHost,
} from '@zhin.js/plugin-runtime';
import type { ConfigDocumentPort, RuntimeConfigDocument } from '@zhin.js/runtime';

/**
 * Plugin Runtime 系统日志落库（console logs 页数据源，对齐 legacy
 * packages/im/zhin/src/log-transport.ts 的 DatabaseLogTransport，但面向
 * DatabaseHost 而非 legacy Plugin inject）。
 *
 * - 表在 host.start() 前 define（见 start-command）；
 * - write 只解析格式化行并 fire-and-forget 写库，host 未 started 时静默丢弃；
 * - 写库失败静默降级，绝不阻塞/炸掉日志路径。
 */

export interface SystemLogStoreConfig {
  /** 最大日志保留天数，默认 7 天 */
  readonly maxDays: number;
  /** 最大日志条数，默认 10000 条 */
  readonly maxRecords: number;
  /** 自动清理间隔（小时），默认 24 小时 */
  readonly cleanupInterval: number;
}

export const DEFAULT_SYSTEM_LOG_CONFIG: SystemLogStoreConfig = Object.freeze({
  maxDays: 7,
  maxRecords: 10_000,
  cleanupInterval: 24,
});

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_REGEX = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*[mGKHF]`, 'g');
/** DefaultFormatter 输出：`[MM-dd HH:mm:ss] [INF] [name]: message`（毫秒可带可不带）。 */
const LOG_LINE_REGEX = /\[[\d-]+ [\d:.]+\] \[(\w+)\] \[([^\]]+)\]: ([\s\S]+)/;

const LEVEL_ALIASES: Readonly<Record<string, 'debug' | 'info' | 'warn' | 'error'>> = {
  dbg: 'debug',
  debug: 'debug',
  inf: 'info',
  info: 'info',
  wrn: 'warn',
  warn: 'warn',
  err: 'error',
  error: 'error',
};

export function mapFormattedLevel(raw: string): 'debug' | 'info' | 'warn' | 'error' | undefined {
  return LEVEL_ALIASES[raw.trim().toLowerCase()];
}

export class SystemLogDatabaseTransport implements LogTransport {
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly host: Pick<DatabaseHost, 'started' | 'models'>,
    private readonly config: SystemLogStoreConfig = DEFAULT_SYSTEM_LOG_CONFIG,
  ) {}

  write(formatted: string): void {
    // host 未启动（或正在重启 generation）时模型不可用，静默丢弃。
    if (!this.host.started) return;
    const match = formatted.replace(ANSI_REGEX, '').match(LOG_LINE_REGEX);
    if (!match) return;
    const level = mapFormattedLevel(match[1] ?? '');
    if (!level) return; // OFF / 未识别级别不落库
    const name = match[2] ?? '';
    const row = {
      level,
      name,
      message: (match[3] ?? '').trim(),
      source: name.split(':')[0] ?? name,
      timestamp: new Date(),
    };
    void insertSystemLogRow(this.host, row).catch(() => {
      // 写库失败静默降级，避免日志存储失败影响主流程
    });
  }

  /** 启动定时清理（立即执行一次；host 未启动时当次跳过）。 */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    void this.cleanupOldLogs();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupOldLogs();
    }, this.config.cleanupInterval * 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  private async cleanupOldLogs(): Promise<void> {
    if (!this.host.started) return;
    const model = this.host.models.get(SYSTEM_LOG_TABLE);
    if (!model) return;
    try {
      // 1. 按时间清理：删除超过 maxDays 天的日志
      const cutoff = new Date(Date.now() - this.config.maxDays * 24 * 60 * 60 * 1000);
      await model.delete().where({ timestamp: { $lt: cutoff } });
      // 2. 按数量清理：超过 maxRecords 时删除最旧的（JS 侧排序，
      //    wrapped DatabaseHostModel 不暴露 orderBy/limit）。
      const rows = await model.select();
      if (rows.length > this.config.maxRecords) {
        const sorted = [...rows].sort((a, b) => toTime(a.timestamp) - toTime(b.timestamp));
        const idsToDelete = sorted
          .slice(0, rows.length - this.config.maxRecords)
          .map((row) => row.id)
          .filter((id) => id != null);
        if (idsToDelete.length > 0) {
          await model.delete().where({ id: { $in: idsToDelete } });
        }
      }
    } catch {
      // 清理失败静默降级
    }
  }
}

function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = new Date(String(value)).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 已挂 transport 的 DatabaseHost（installResources 按 generation 重跑，transport 只挂一次）。 */
const transportInstallations = new WeakSet<object>();

/**
 * 装配系统日志落库：注册 SystemLog 表 + 给根 logger 挂 transport + 启动清理任务。
 * 幂等（按 DatabaseHost 实例去重）；表 define 必须在 host.start() 之前。
 */
export function installSystemLogStore(
  host: DatabaseHost,
  config: SystemLogStoreConfig = DEFAULT_SYSTEM_LOG_CONFIG,
): void {
  defineSystemLogTable(host);
  if (transportInstallations.has(host)) return;
  transportInstallations.add(host);
  const transport = new SystemLogDatabaseTransport(host, config);
  addTransport(transport);
  transport.startCleanup();
}

/** 从 Runtime 配置文档读取 `log.*` 清理策略（对齐 legacy AppConfig.log），缺省用默认值。 */
export async function resolveSystemLogConfig(
  config: RuntimeConfigDocument | ConfigDocumentPort,
): Promise<SystemLogStoreConfig> {
  const document = isConfigDocumentPort(config) ? (await config.read()).document : config;
  const raw = document && typeof document === 'object'
    ? (document as Record<string, unknown>).log
    : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_SYSTEM_LOG_CONFIG;
  const value = raw as Record<string, unknown>;
  return Object.freeze({
    maxDays: positiveNumber(value.maxDays) ?? DEFAULT_SYSTEM_LOG_CONFIG.maxDays,
    maxRecords: positiveNumber(value.maxRecords) ?? DEFAULT_SYSTEM_LOG_CONFIG.maxRecords,
    cleanupInterval: positiveNumber(value.cleanupInterval) ?? DEFAULT_SYSTEM_LOG_CONFIG.cleanupInterval,
  });
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isConfigDocumentPort(value: unknown): value is ConfigDocumentPort {
  return Boolean(value && typeof value === 'object'
    && typeof (value as Partial<ConfigDocumentPort>).read === 'function');
}
