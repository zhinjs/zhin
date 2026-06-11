// 导入所有内容从 logger.ts
export {
  LOG_LEVEL_COLORS,
  Logger,
  DefaultFormatter,
  ConsoleTransport,
  FileTransport,
  StreamTransport,
  getLogger,
  setLogger,
  setOptions,
  addTransport,
  removeTransport,
  setFormatter,
  setLevel,
  getLevel,
  isLevelEnabled,
  setName,
  getName,
  getLoggerNames
} from './logger.js'

export type {
  LogEntry,
  LogFormatter,
  LogTransport,
  LoggerOptions,
  TransportSecurityOptions,
  LoggerColorOptions,
  ColorFunction,
  Timer
} from './logger.js'

export {
  formatCompact,
  formatCompactLog,
  formatCompactUsage,
  addCompactUsage,
  truncatePreview,
  EMPTY_COMPACT_USAGE,
} from './compact-log.js'
export type { CompactFieldValue, CompactUsage } from './compact-log.js'

export {
  toLogLevelName,
  isValidLogLevelInput,
  parseLogLevel,
  toLog4jsLevel,
  isLogLevel,
  isLogLevelEnabled,
  logLevelFromLog4js,
  LogLevel,
  LOG_LEVEL_NAMES,
} from './log-level.js'
export type { LogLevelInput, Log4jsLevel, LogLevelName } from './log-level.js'

// 导入默认logger和便捷方法
import defaultLogger from './logger.js'

// 便捷方法（使用默认logger）
export const debug = (message: string, ...args: any[]) => defaultLogger.debug(message, ...args)
export const info = (message: string, ...args: any[]) => defaultLogger.info(message, ...args)
export const success = (message: string, ...args: any[]) => defaultLogger.success(message, ...args)
export const warn = (message: string, ...args: any[]) => defaultLogger.warn(message, ...args)
export const error = (message: string, ...args: any[]) => defaultLogger.error(message, ...args)
export const time = (label: string) => defaultLogger.time(label)
export const timeEnd = (label: string) => defaultLogger.timeEnd(label)

export default defaultLogger