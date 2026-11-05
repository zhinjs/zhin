import { addTransport, removeTransport, type LogTransport } from '@zhin.js/logger';
import {
  defineSystemLogTable,
  insertSystemLogRow,
  SYSTEM_LOG_TABLE,
  type ConfigDocumentPort,
  type DatabaseHost,
  type RuntimeConfigDocument,
} from '@zhin.js/plugin-runtime';

/**
 * Plugin Runtime 系统日志落库（console logs 页数据源，对齐 legacy
 * packages/im/zhin/src/log-transport.ts 的 DatabaseLogTransport，但面向
 * DatabaseHost 而非 legacy Plugin inject）。
 *
 * - 表在 host.start() 前 define（见 start-command）；
 * - write 只解析格式化行并 fire-and-forget 写库，host 未 started 时静默丢弃；
 * - 写库失败静默降级，绝不阻塞/炸掉日志路径。
 */

export interface ConsoleLogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly name: string;
  readonly message: string;
  readonly source: string;
  readonly timestamp: string;
}

export interface SystemLogEventBus {
  publish?(type: string, data: unknown): unknown;
  emit?(type: string, data: unknown): unknown;
}

export interface SystemLogRecordingOptions {
  readonly eventBus?: SystemLogEventBus;
  readonly eventHub?: SystemLogEventBus;
  readonly onEntry?: (entry: ConsoleLogEntry) => void;
}

export interface SystemLogStoreConfig extends SystemLogRecordingOptions {
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
/** Current DefaultFormatter: `[HH:mm:ss.SSS][LEVEL] [name] message`. */
const CURRENT_LOG_LINE_REGEX = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\]\[(\w+)\](?: \[([^\[\]]+)\])? ([\s\S]*)$/;
/** Accept persisted/older formatters without changing their existing contract. */
const LOG_LINE_REGEX = /\[[\d-]+ [\d:.]+\] \[(\w+)\] \[([^\[\]]+)\]: ([\s\S]+)/;

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

function isEventBus(value: unknown): value is SystemLogEventBus {
  return Boolean(
    value
    && typeof value === 'object'
    && (typeof (value as SystemLogEventBus).publish === 'function'
      || typeof (value as SystemLogEventBus).emit === 'function'),
  );
}

export class SystemLogDatabaseTransport implements LogTransport {
  private cleanupTimer?: NodeJS.Timeout;
  private readonly config: SystemLogStoreConfig;
  private readonly eventBus?: SystemLogEventBus;
  private readonly onEntry?: (entry: ConsoleLogEntry) => void;

  constructor(
    private readonly host: Pick<DatabaseHost, 'started' | 'models'>,
    configOrOptions: Partial<SystemLogStoreConfig> & SystemLogRecordingOptions = DEFAULT_SYSTEM_LOG_CONFIG,
    thirdArg?: SystemLogRecordingOptions | SystemLogEventBus | ((entry: ConsoleLogEntry) => void),
  ) {
    this.config = Object.freeze({
      maxDays: configOrOptions.maxDays ?? DEFAULT_SYSTEM_LOG_CONFIG.maxDays,
      maxRecords: configOrOptions.maxRecords ?? DEFAULT_SYSTEM_LOG_CONFIG.maxRecords,
      cleanupInterval: configOrOptions.cleanupInterval ?? DEFAULT_SYSTEM_LOG_CONFIG.cleanupInterval,
    });
    const extraOptions: SystemLogRecordingOptions = typeof thirdArg === 'function'
      ? { onEntry: thirdArg }
      : isEventBus(thirdArg)
        ? { eventBus: thirdArg }
        : (thirdArg ?? {});
    this.eventBus = extraOptions.eventBus ?? extraOptions.eventHub ?? configOrOptions.eventBus ?? configOrOptions.eventHub;
    this.onEntry = extraOptions.onEntry ?? configOrOptions.onEntry;
  }

  write(formatted: string): void {
    const plain = formatted.replace(ANSI_REGEX, '');
    const match = plain.match(CURRENT_LOG_LINE_REGEX) ?? plain.match(LOG_LINE_REGEX);
    if (!match) return;
    const level = mapFormattedLevel(match[1] ?? '');
    if (!level) return; // OFF / 未识别级别不落库
    const name = match[2] ?? '';
    const now = new Date();
    const row = {
      level,
      name,
      message: (match[3] ?? '').trim(),
      source: name.split(':')[0] ?? name,
      timestamp: now,
    };
    if (this.onEntry || this.eventBus) {
      const entry: ConsoleLogEntry = Object.freeze({
        level: row.level,
        name: row.name,
        message: row.message,
        source: row.source,
        timestamp: now.toISOString(),
      });
      try {
        this.onEntry?.(entry);
      } catch {
        // 回调失败静默降级
      }
      if (this.eventBus) {
        try {
          if (typeof this.eventBus.emit === 'function') {
            this.eventBus.emit('log:entry', entry);
          } else if (typeof this.eventBus.publish === 'function') {
            this.eventBus.publish('log:entry', entry);
          }
        } catch {
          // 事件总线发布失败静默降级
        }
      }
    }
    // host 未启动（或正在重启 generation）时模型不可用，静默丢弃。
    if (!this.host.started) return;
    void insertSystemLogRow(this.host, row).catch(() => {
      // 写库失败静默降级，避免日志存储失败影响主流程
    });
  }

  /** 启动定时清理（立即执行一次；host 未启动时当次跳过）。 */
  startCleanup(): void {
    if (this.cleanupTimer) return;
    void this.prune();
    this.cleanupTimer = setInterval(() => {
      void this.prune();
    }, this.config.cleanupInterval * 60 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  async prune(): Promise<void> {
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

export interface SystemLogTransportRegistry {
  add(transport: LogTransport): void;
  remove(transport: LogTransport): void;
}

const rootLoggerTransports: SystemLogTransportRegistry = Object.freeze({
  add: addTransport,
  remove: removeTransport,
});

/** Owns the database log transport and its cleanup timer for one process composition. */
export class SystemLogStore {
  readonly #transport: SystemLogDatabaseTransport;
  readonly #registry: SystemLogTransportRegistry;
  #disposed = false;

  constructor(
    host: DatabaseHost,
    config: Partial<SystemLogStoreConfig> & SystemLogRecordingOptions = DEFAULT_SYSTEM_LOG_CONFIG,
    registry: SystemLogTransportRegistry = rootLoggerTransports,
    options?: SystemLogRecordingOptions | SystemLogEventBus | ((entry: ConsoleLogEntry) => void),
  ) {
    defineSystemLogTable(host);
    this.#transport = new SystemLogDatabaseTransport(host, config, options);
    this.#registry = registry;
    this.#registry.add(this.#transport);
    this.#transport.startCleanup();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#transport.stopCleanup();
    this.#registry.remove(this.#transport);
  }
}

export function installSystemLogRecording(
  host: DatabaseHost,
  config: Partial<SystemLogStoreConfig> & SystemLogRecordingOptions & {
    readonly registry?: SystemLogTransportRegistry;
    readonly sink?: SystemLogTransportRegistry;
  } = DEFAULT_SYSTEM_LOG_CONFIG,
  options: SystemLogRecordingOptions & {
    readonly registry?: SystemLogTransportRegistry;
    readonly sink?: SystemLogTransportRegistry;
  } = {},
): SystemLogStore {
  const registry = options.registry ?? options.sink ?? config.registry ?? config.sink ?? rootLoggerTransports;
  return new SystemLogStore(host, config, registry, options);
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
