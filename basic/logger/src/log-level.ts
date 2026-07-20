/**
 * zhin 日志级别 — 底层统一为小写字符串（与 qq-official-bot / log4js 一致）。
 * 数字 0–4 仅在 parse 入口兼容，内部不再使用。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/** 常量写法，兼容 `LogLevel.INFO` */
export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  SILENT: 'silent',
} as const satisfies Record<string, LogLevel>;

export type LogLevelName = LogLevel;

/** log4js / qq-official-bot 扩展级别 */
export type Log4jsLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'
  | 'mark'
  | 'off';

export type LogLevelInput = LogLevel | Log4jsLevel | number | string;

/** 控制台展示用大写名 */
export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
  silent: 'OFF',
};

const LEGACY_NUMERIC: Record<number, LogLevel> = {
  0: 'debug',
  1: 'info',
  2: 'warn',
  3: 'error',
  4: 'silent',
};

const NAME_TO_LEVEL: Record<string, LogLevel> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  mark: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
  silent: 'silent',
  off: 'silent',
};

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const LEVEL_TO_LOG4JS: Record<LogLevel, Log4jsLevel> = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  silent: 'off',
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LEVEL_RANK;
}

export function isLogLevelEnabled(messageLevel: LogLevel, threshold: LogLevel): boolean {
  return LEVEL_RANK[messageLevel] >= LEVEL_RANK[threshold];
}

/**
 * 解析任意输入为 zhin 内部 LogLevel 字符串。
 */
export function parseLogLevel(input: unknown, fallback: LogLevel = LogLevel.INFO): LogLevel {
  if (input == null || input === '') return fallback;
  if (isLogLevel(input)) return input;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return LEGACY_NUMERIC[Math.trunc(input)] ?? fallback;
  }
  if (typeof input === 'string') {
    const key = input.trim().toLowerCase();
    if (key in NAME_TO_LEVEL) return NAME_TO_LEVEL[key]!;
  }
  return fallback;
}

/** @alias parseLogLevel — 规范为配置用小写字符串 */
export function toLogLevelName(input: LogLevelInput, fallback: LogLevel = LogLevel.INFO): LogLevel {
  return parseLogLevel(input, fallback);
}

/** 转为 qq-official-bot / log4js 传参 */
export function toLog4jsLevel(input: LogLevelInput, fallback: LogLevel = LogLevel.INFO): Log4jsLevel {
  return LEVEL_TO_LOG4JS[parseLogLevel(input, fallback)];
}

export function logLevelFromLog4js(level: string, fallback: LogLevel = LogLevel.INFO): LogLevel {
  return parseLogLevel(level, fallback);
}

export function isValidLogLevelInput(input: unknown): boolean {
  if (input == null || input === '') return false;
  if (isLogLevel(input)) return true;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.trunc(input) in LEGACY_NUMERIC;
  }
  if (typeof input === 'string') {
    return input.trim().toLowerCase() in NAME_TO_LEVEL;
  }
  return false;
}
