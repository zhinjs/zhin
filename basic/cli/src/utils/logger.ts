import chalk from 'chalk'
import {
  DefaultFormatter,
  getLogger,
  LogLevel,
  parseLogLevel,
  type LogEntry,
  type LogFormatter,
  type LogTransport,
} from '@zhin.js/logger'
import { isCliVerbose } from './cli-flags.js'

/**
 * Diagnostic logging of the CLI (#1250). It writes to **stderr**, so a command's results on stdout
 * (see `output.ts`) stay clean for reading and piping. Without `--verbose` a line is just the
 * message (warnings and errors keep a short marker); with `--verbose` (or `ZHIN_CLI_VERBOSE=1`) it
 * gets the usual `[time][LEVEL] [CLI]` prefix.
 */
const verboseFormatter = new DefaultFormatter()

export const cliLogFormatter: LogFormatter = {
  format(entry: LogEntry): string {
    if (isCliVerbose()) return verboseFormatter.format(entry)
    const level = parseLogLevel(entry.level)
    if (level === LogLevel.ERROR) return `${chalk.red('✖')} ${entry.message}`
    if (level === LogLevel.WARN) return `${chalk.yellow('⚠')} ${entry.message}`
    return entry.message
  },
}

export const stderrTransport: LogTransport = {
  write(formatted: string): void {
    process.stderr.write(`${formatted}\n`)
  },
}

// 创建CLI专用的logger
const cliLogger = getLogger('CLI', { formatter: cliLogFormatter, transports: [stderrTransport] })

// 根据环境变量设置日志级别
const logLevel = process.env.ZHIN_LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info')
switch (logLevel.toLowerCase()) {
  case 'debug':
    cliLogger.setLevel(LogLevel.DEBUG)
    break
  case 'warn':
    cliLogger.setLevel(LogLevel.WARN)
    break
  case 'error':
    cliLogger.setLevel(LogLevel.ERROR)
    break
  case 'silent':
    cliLogger.setLevel(LogLevel.SILENT)
    break
  default:
    cliLogger.setLevel(LogLevel.INFO)
}

export const logger = {
  info: (message: string, ...args: any[]) => {
    if (args.length > 0) {
      // 对于多个参数，直接拼接到消息中，这样更自然
      const fullMessage = message + ' ' + args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ')
      cliLogger.info(fullMessage)
    } else {
      cliLogger.info(message)
    }
  },
  
  success: (message: string, ...args: any[]) => {
    if (args.length > 0) {
      const fullMessage = message + ' ' + args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ')
      cliLogger.success(fullMessage)
    } else {
      cliLogger.success(message)
    }
  },
  
  warn: (message: string, ...args: any[]) => {
    if (args.length > 0) {
      const fullMessage = message + ' ' + args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ')
      cliLogger.warn(fullMessage)
    } else {
      cliLogger.warn(message)
    }
  },
  
  error: (message: string, ...args: any[]) => {
    if (args.length > 0) {
      const fullMessage = message + ' ' + args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ')
      cliLogger.error(fullMessage)
    } else {
      cliLogger.error(message)
    }
  },
  
  debug: (message: string, ...args: any[]) => {
    if (args.length > 0) {
      const fullMessage = message + ' ' + args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ')
      cliLogger.debug(fullMessage)
    } else {
      cliLogger.debug(message)
    }
  }
}; 