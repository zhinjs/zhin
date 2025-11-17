import { getLogger, LogLevel } from '@zhin.js/logger'

// 创建CLI专用的logger
const cliLogger = getLogger('CLI')

// 根据环境变量设置日志级别
const logLevel = process.env.ZHIN_LOG_LEVEL || process.env.NODE_ENV === 'development' ? 'debug' : 'info'
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
  
  log: (message: string, ...args: any[]) => {
    if (args.length > 0) {
      const fullMessage = message + ' ' + args.map(arg => 
        typeof arg === 'string' ? arg : JSON.stringify(arg)
      ).join(' ')
      cliLogger.info(fullMessage)
    } else {
      cliLogger.info(message)
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