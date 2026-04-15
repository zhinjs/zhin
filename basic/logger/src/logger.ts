import chalk from 'chalk'
import { performance } from 'node:perf_hooks'
import { format } from 'node:util'
import { WriteStream } from 'node:fs'

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}

/**
 * 日志级别名称映射
 */
export const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT'
}

/**
 * 日志级别颜色映射
 */
export const LOG_LEVEL_COLORS: Record<LogLevel, (text: string) => string> = {
  [LogLevel.DEBUG]: chalk.gray,
  [LogLevel.INFO]: chalk.blue,
  [LogLevel.WARN]: chalk.yellow,
  [LogLevel.ERROR]: chalk.red,
  [LogLevel.SILENT]: chalk.gray
}

/**
 * Logger 名称颜色映射（循环使用）
 */
const NAME_COLORS = [
  chalk.cyan,
  chalk.magenta,
  chalk.green,
  chalk.yellow,
  chalk.blue,
  chalk.red
]

/**
 * 日志条目接口
 */
export interface LogEntry {
  level: LogLevel
  name: string
  message: string
  timestamp: Date
  args: any[]
  error?: Error
}

/**
 * 日志格式化器接口
 */
export interface LogFormatter {
  format(entry: LogEntry): string
}

/**
 * 日志输出器接口
 */
export interface LogTransport {
  write(formatted: string): void
}

/**
 * Transport安全选项
 */
export interface TransportSecurityOptions {
  /** 是否移除ANSI转义序列 */
  removeAnsi?: boolean
  /** 是否脱敏敏感信息 */
  maskSensitive?: boolean
}

/**
 * 颜色函数类型
 */
export type ColorFunction = (text: string) => string

/**
 * Logger 颜色配置选项
 */
export interface LoggerColorOptions {
  /** 日志级别颜色映射（覆盖默认级别颜色） */
  levelColors?: Partial<Record<LogLevel, ColorFunction>>
  /** Logger名称颜色（可以是单个颜色或颜色数组） */
  nameColor?: ColorFunction | ColorFunction[]
  /** 日期时间颜色 */
  dateColor?: ColorFunction
}

/**
 * Logger 配置选项
 */
export interface LoggerOptions {
  /** 日志级别 */
  level?: LogLevel
  /** 自定义格式化器 */
  formatter?: LogFormatter
  /** 输出器列表 */
  transports?: LogTransport[]
  /** 颜色配置 */
  colors?: LoggerColorOptions
  /** 性能选项 */
  performance?: {
    /** 最大子Logger数量（默认1000） */
    maxChildLoggers?: number
    /** 最大Timer数量（默认100） */
    maxTimers?: number
  }
}

/**
 * 安全工具类
 */
class LogSanitizer {
  private static readonly ANSI_REGEX = /\x1b\[[0-9;]*[mGKHF]/g
  private static readonly SENSITIVE_PATTERNS = [
    /password['\s]*[:=]['\s]*([^'\s,}]+)/gi,
    /token['\s]*[:=]['\s]*([^'\s,}]+)/gi,  
    /key['\s]*[:=]['\s]*([^'\s,}]+)/gi,
    /secret['\s]*[:=]['\s]*([^'\s,}]+)/gi,
    /apikey['\s]*[:=]['\s]*([^'\s,}]+)/gi
  ]

  /**
   * 移除ANSI转义序列
   */
  static removeAnsi(message: string): string {
    return message.replace(this.ANSI_REGEX, '')
  }

  /**
   * 脱敏敏感信息
   */
  static maskSensitive(message: string): string {
    let sanitized = message
    for (const pattern of this.SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, (match, value) => {
        const masked = value.length > 4 
          ? value.substring(0, 2) + '*'.repeat(value.length - 4) + value.substring(value.length - 2)
          : '*'.repeat(value.length)
        return match.replace(value, masked)
      })
    }
    return sanitized
  }
}

/**
 * 默认格式化器 - 【date】【level】【name】：【message】
 * 只负责格式化，不处理安全净化（由Transport处理）
 */
export class DefaultFormatter implements LogFormatter {
  private nameColorMap = new Map<string, ColorFunction>()
  private colorIndex = 0
  private readonly maxCacheSize = 1000
  
  // 可自定义的颜色配置
  private levelColors: Record<LogLevel, ColorFunction>
  private nameColors: ColorFunction[]
  private dateColor: ColorFunction

  constructor(colorOptions?: LoggerColorOptions) {
    // 初始化级别颜色（可覆盖默认值）
    this.levelColors = {
      ...LOG_LEVEL_COLORS,
      ...colorOptions?.levelColors
    }
    
    // 初始化名称颜色（可自定义）
    if (colorOptions?.nameColor) {
      this.nameColors = Array.isArray(colorOptions.nameColor) 
        ? colorOptions.nameColor 
        : [colorOptions.nameColor]
    } else {
      this.nameColors = NAME_COLORS
    }
    
    // 初始化日期颜色
    this.dateColor = colorOptions?.dateColor ?? chalk.gray
  }

  private getNameColor(name: string): ColorFunction {
    if (!this.nameColorMap.has(name)) {
      // 防止缓存无限增长
      if (this.nameColorMap.size >= this.maxCacheSize) {
        const entries = Array.from(this.nameColorMap.entries())
        this.nameColorMap.clear()
        // 保留最新的500个
        for (const [key, value] of entries.slice(-500)) {
          this.nameColorMap.set(key, value)
        }
      }

      this.nameColorMap.set(name, this.nameColors[this.colorIndex % this.nameColors.length])
      this.colorIndex++
    }
    return this.nameColorMap.get(name)!
  }

  format(entry: LogEntry): string {
    const { level, name, message, timestamp, error } = entry

    // 格式化时间：MM-dd HH:MM:ss.SSS（使用自定义颜色）
    const date = timestamp.toISOString().slice(5, 23).replace('T', ' ')
    const dateStr = this.dateColor(`[${date}]`)

    // 格式化级别（使用自定义颜色）
    const levelName = LOG_LEVEL_NAMES[level]
    const levelStr = this.levelColors[level](`[${levelName}]`)

    // 格式化名称（使用自定义颜色）
    const nameColor = this.getNameColor(name)
    const nameStr = nameColor(`[${name}]`)

    // 基础格式：【date】【level】【name】：【message】
    let result = `${dateStr} ${levelStr} ${nameStr}: ${message}`

    // 如果是错误级别且有错误对象，添加堆栈信息
    if (level === LogLevel.ERROR && error && error.stack) {
      result += '\n' + this.levelColors[level](error.stack)
    }

    return result
  }
}

/**
 * 控制台输出器 - 开发友好，默认保留颜色和完整信息
 */
export class ConsoleTransport implements LogTransport {
  constructor(private securityOptions?: TransportSecurityOptions) {}

  write(formatted: string): void {
    let output = formatted

    // 控制台输出的安全处理（默认不脱敏，便于开发调试）
    const removeAnsi = this.securityOptions?.removeAnsi ?? false
    const maskSensitive = this.securityOptions?.maskSensitive ?? false

    if (removeAnsi) {
      output = LogSanitizer.removeAnsi(output)
    }

    if (maskSensitive) {
      output = LogSanitizer.maskSensitive(output)
    }

    // 直接使用 console.log，保持与 console.info 一致的行为
    console.log(output)
  }
}

/**
 * 文件输出器 - 生产安全，默认去除颜色和脱敏
 */
export class FileTransport implements LogTransport {
  constructor(
    private stream: WriteStream, 
    private securityOptions?: TransportSecurityOptions
  ) {}

  write(formatted: string): void {
    let output = formatted

    // 文件输出的安全处理（默认脱敏，保护生产环境）
    const removeAnsi = this.securityOptions?.removeAnsi ?? true  // 文件默认去掉颜色
    const maskSensitive = this.securityOptions?.maskSensitive ?? true  // 文件默认脱敏

    if (removeAnsi) {
      output = LogSanitizer.removeAnsi(output)
    }

    if (maskSensitive) {
      output = LogSanitizer.maskSensitive(output)
    }

    this.stream.write(output + '\n')
  }
}

/**
 * 流输出器 - 可配置安全选项
 */
export class StreamTransport implements LogTransport {
  constructor(
    private stream: NodeJS.WritableStream,
    private securityOptions?: TransportSecurityOptions
  ) {}

  write(formatted: string): void {
    let output = formatted

    // 流输出的安全处理（可配置）
    const removeAnsi = this.securityOptions?.removeAnsi ?? false
    const maskSensitive = this.securityOptions?.maskSensitive ?? false

    if (removeAnsi) {
      output = LogSanitizer.removeAnsi(output)
    }

    if (maskSensitive) {
      output = LogSanitizer.maskSensitive(output)
    }

    this.stream.write(output + '\n')
  }
}

/**
 * 性能计时器
 */
export interface Timer {
  end(): void
}

/**
 * Logger 类 - 自管理子 Logger
 */
export class Logger {
  private level: LogLevel=LogLevel.INFO
  private formatter: LogFormatter=new DefaultFormatter()
  private transports: LogTransport[]=[new ConsoleTransport()]
  private timers = new Map<string, number>()
  private childLoggers = new Map<string, Logger>()
  #parent: Logger | null
  #name: string
  
  // 🔧 性能配置
  private readonly maxChildLoggers: number
  private readonly maxTimers: number
  constructor(
    parent: Logger | null,
    name:string,
    options: LoggerOptions = {},
  ) {
    this.#name=name
    this.#parent = parent
    
    // 初始化性能配置
    this.maxChildLoggers = options.performance?.maxChildLoggers ?? 1000
    this.maxTimers = options.performance?.maxTimers ?? 100
    
    this.setOptions(options)
  }
  get name(){
    return this.#name
  }
  set name(name:string){
    this.#name=name
  }
  /**
   * 设置日志级别
   * @param level
   * @param recursive 是否同时设置所有子 Logger 的级别
   */
  setLevel(level: LogLevel, recursive: boolean = false): void {
    this.level = level
    
    if (recursive) {
      // 🔧 防止递归过深
      const maxDepth = 50
      this.setLevelRecursive(level, 0, maxDepth)
    }
  }

  /**
   * 递归设置级别，带深度检查
   */
  private setLevelRecursive(level: LogLevel, currentDepth: number, maxDepth: number): void {
    if (currentDepth >= maxDepth) {
      console.warn(`[Logger] 递归深度超过${maxDepth}，停止递归设置`)
      return
    }

    for (const childLogger of this.childLoggers.values()) {
      childLogger.level = level
      childLogger.setLevelRecursive(level, currentDepth + 1, maxDepth)
    }
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level
  }

  /**
   * 检查指定级别是否启用
   */
  isLevelEnabled(level: LogLevel): boolean {
    return level >= this.level
  }

  /**
   * 添加输出器
   * @param transport
   * @param recursive 是否同时添加到所有子 Logger
   */
  addTransport(transport: LogTransport, recursive: boolean = false): void {
    this.transports.push(transport)
    
    if (recursive) {
      for (const childLogger of this.childLoggers.values()) {
        childLogger.addTransport(transport, recursive)
      }
    }
  }

  /**
   * 移除输出器
   * @param transport
   * @param recursive 是否同时从所有子 Logger 移除
   */
  removeTransport(transport: LogTransport, recursive: boolean = false): void {
    const index = this.transports.indexOf(transport)
    if (index > -1) {
      this.transports.splice(index, 1)
    }
    
    if (recursive) {
      for (const childLogger of this.childLoggers.values()) {
        childLogger.removeTransport(transport, recursive)
      }
    }
  }

  /**
   * 设置格式化器
   * @param formatter
   * @param recursive 是否同时设置所有子 Logger 的格式化器
   */
  setFormatter(formatter: LogFormatter, recursive: boolean = false): void {
    this.formatter = formatter
    
    if (recursive) {
      for (const childLogger of this.childLoggers.values()) {
        childLogger.setFormatter(formatter, recursive)
      }
    }
  }
  hasLogger(name: string): boolean {
    return this.childLoggers.has(name)
  }
  /**
   * 获取或创建子 Logger
   * @param namespace 子命名空间
   * @param options 可选配置，会覆盖从父级继承的配置
   */
  getLogger(namespace: string, options?: LoggerOptions): Logger {
    // 🔧 内存管理：检查子Logger数量
    this.checkChildLoggerLimit()
    
    if (!this.childLoggers.has(namespace)) {
      const childName = `${this.name}:${namespace}`
      const childLogger = new Logger(this,childName, options ?? {})
      this.childLoggers.set(namespace, childLogger)
    }
    return this.childLoggers.get(namespace)!
  }

  /**
   * 检查并清理过多的子Logger
   */
  private checkChildLoggerLimit(): void {
    if (this.childLoggers.size >= this.maxChildLoggers) {
      const entries = Array.from(this.childLoggers.entries())
      const toRemove = Math.floor(this.maxChildLoggers * 0.1) // 移除10%
      
      for (let i = 0; i < toRemove; i++) {
        const [key] = entries[i]
        this.childLoggers.delete(key)
      }
      
      console.warn(`[Logger] 清理了${toRemove}个子Logger，当前数量: ${this.childLoggers.size}`)
    }
  }
  setLogger(name: string, options?: LoggerOptions): Logger {
    if (this.childLoggers.has(name)) {
      this.childLoggers.get(name)!.setOptions(options)
    } else {
      const childLogger = new Logger(this,name, options ?? {})
      this.childLoggers.set(name, childLogger)
    }
    return this.childLoggers.get(name)!
  }
  setOptions(options: LoggerOptions={}): void {
    // 如果有父 Logger，默认继承父级配置，然后应用自定义选项
    if (this.#parent) {
      this.level = options.level ?? this.#parent?.level??LogLevel.INFO
      this.formatter = options.formatter ?? this.#parent?.formatter??new DefaultFormatter(options.colors) 
      this.transports = options.transports ?? [...this.#parent?.transports??[]]
    } else {
      this.level = options.level ?? LogLevel.INFO
      this.formatter = options.formatter ?? new DefaultFormatter(options.colors)
      this.transports = options.transports ?? [new ConsoleTransport()]
    }
  }
  /**
   * 移除子 Logger
   */
  removeLogger(namespace: string): boolean {
    return this.childLoggers.delete(namespace)
  }

  /**
   * 获取所有子 Logger 名称
   */
  getLoggerNames(): string[] {
    return Array.from(this.childLoggers.keys())
  }

  
  get parent(): Logger | null {
    return this.#parent
  }

  /**
   * 检查是否为根 Logger
   */
  isRoot(): boolean {
    return !this.#parent
  }

  /**
   * 记录日志的通用方法
   */
  private log(level: LogLevel, ...args: any[]): void {
    if (!this.isLevelEnabled(level)) {
      return
    }

    // 检查是否有Error对象
    let error: Error | undefined
    if (level === LogLevel.ERROR) {
      // 在参数中查找Error对象
      error = args.find(arg => arg instanceof Error)
      
      // 如果第一个参数是Error对象，使用其message作为主要消息
      if (args[0] instanceof Error) {
        const err = args[0] as Error
        error = err
        args = args.slice(1) // 移除Error对象，避免重复显示
      }
    }

    // 处理参数格式化，与 console.info 行为一致
    const formattedMessage = format(...args)

    const entry: LogEntry = {
      level,
      name: this.name,
      message: formattedMessage,
      timestamp: new Date(),
      args,
      error
    }

    const formatted = this.formatter.format(entry)
    
    // 输出到所有 transport
    for (const transport of this.transports) {
      try {
        transport.write(formatted)
      } catch (err) {
        // 避免日志系统本身的错误导致应用崩溃
        console.error('Logger transport error:', err)
      }
    }
  }

  /**
   * DEBUG 级别日志
   */
  debug(...args: any[]): void {
    this.log(LogLevel.DEBUG, ...args)
  }

  /**
   * INFO 级别日志
   */
  info(...args: any[]): void {
    this.log(LogLevel.INFO, ...args)
  }

  /**
   * SUCCESS 日志（INFO 级别，带绿色 ✓ 标记）
   */
  success(...args: any[]): void {
    this.log(LogLevel.INFO, chalk.green('✓ '), ...args)
  }

  /**
   * WARN 级别日志
   */
  warn(...args: any[]): void {
    this.log(LogLevel.WARN, ...args)
  }

  /**
   * ERROR 级别日志
   * 支持传入Error对象，会自动打印错误堆栈信息
   * @param message 错误消息
   * @param args 其他参数，如果第一个参数是Error对象，会使用其message并打印堆栈
   */
  error(...args: any[]): void {
    this.log(LogLevel.ERROR,...args)
  }

  /**
   * 开始性能计时
   */
  time(label: string): Timer {
    // 🔧 清理过期的timer
    this.cleanupTimers()
    
    const startTime = performance.now()
    this.timers.set(label, startTime)
    
    return {
      end: () => {
        const endTime = performance.now()
        const duration = endTime - startTime
        this.timers.delete(label)
        this.info(`${label} took ${duration.toFixed(2)}ms`)
      }
    }
  }

  /**
   * 清理过期的Timer
   */
  private cleanupTimers(): void {
    if (this.timers.size >= this.maxTimers) {
      const now = performance.now()
      const fiveMinutes = 5 * 60 * 1000 // 5分钟
      let cleaned = 0
      
      for (const [label, startTime] of this.timers.entries()) {
        if (now - startTime > fiveMinutes) {
          this.timers.delete(label)
          cleaned++
        }
      }
      
      // 如果还是太多，清理最老的一批
      if (this.timers.size >= this.maxTimers) {
        const entries = Array.from(this.timers.entries())
        const toRemove = Math.floor(this.maxTimers * 0.2) // 移除20%
        
        for (let i = 0; i < toRemove && i < entries.length; i++) {
          const [label] = entries[i]
          this.timers.delete(label)
          cleaned++
        }
      }
      
      if (cleaned > 0) {
        console.warn(`[Logger] 清理了${cleaned}个过期Timer，当前数量: ${this.timers.size}`)
      }
    }
  }

  /**
   * 结束性能计时
   */
  timeEnd(label: string): void {
    const startTime = this.timers.get(label)
    if (startTime) {
      const duration = performance.now() - startTime
      this.timers.delete(label)
      this.info(`${label} took ${duration.toFixed(2)}ms`)
    } else {
      this.warn(`Timer '${label}' does not exist`)
    }
  }

  /**
   * 条件日志
   */
  logIf(condition: boolean, level: LogLevel, message: string, ...args: any[]): void {
    if (condition) {
      this.log(level, message, ...args)
    }
  }

  /**
   * 获取 logger 名称
   */
  getName(): string {
    return this.name
  }
}
const defaultLogger=new Logger(null,'Zhin');
export function getLogger(name: string, options: LoggerOptions = {}, parent=defaultLogger): Logger {
  return parent.getLogger(name, options)
}
export function setLogger(name:string,options?:LoggerOptions,parent:Logger=defaultLogger): Logger {
  return parent.setLogger(name, options)
}
export function setOptions(options: LoggerOptions={},logger:Logger=defaultLogger) {
  return logger.setOptions(options)
}
export function addTransport(transport: LogTransport,logger:Logger=defaultLogger) {
  return logger.addTransport(transport,true)
}
export function removeTransport(transport: LogTransport,logger:Logger=defaultLogger) {
  return logger.removeTransport(transport,true)
}
export function setFormatter(formatter: LogFormatter,logger:Logger=defaultLogger) {
  return logger.setFormatter(formatter)
}
export function setLevel(level: LogLevel,logger:Logger=defaultLogger) {
  return logger.setLevel(level)
}
export function getLevel(logger:Logger=defaultLogger) {
  return logger.getLevel()
}
export function isLevelEnabled(level: LogLevel,logger:Logger=defaultLogger) {
  return logger.isLevelEnabled(level)
}
export function setName(name:string,logger:Logger=defaultLogger) {
  return logger.name=name
}
export function getName(logger:Logger=defaultLogger) {
  return logger.name
}
export function getLoggerNames(logger:Logger=defaultLogger) {
  return logger.getLoggerNames()
}
export default defaultLogger