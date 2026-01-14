import { describe, it, expect, beforeEach } from 'vitest'
import {
  Logger,
  LogLevel,
  debug,
  info,
  success,
  warn,
  error,
  time,
  timeEnd,
  getLogger,
  setLogger,
  setLevel,
  getLevel,
  isLevelEnabled,
  setName,
  getName
} from '../src/index'

describe('Logger', () => {
  describe('Logger instance', () => {
    it('should create logger with default options', () => {
      const logger = new Logger()
      expect(logger).toBeInstanceOf(Logger)
    })

    it('should create logger with custom name', () => {
      const logger = new Logger({ name: 'test-logger' })
      expect(logger).toBeInstanceOf(Logger)
    })

    it('should create logger with custom level', () => {
      const logger = new Logger({ level: LogLevel.WARN })
      expect(logger).toBeInstanceOf(Logger)
    })
  })

  describe('Logging methods', () => {
    let logger: Logger

    beforeEach(() => {
      logger = new Logger({ name: 'test' })
    })

    it('should have debug method', () => {
      expect(typeof logger.debug).toBe('function')
      expect(() => logger.debug('debug message')).not.toThrow()
    })

    it('should have info method', () => {
      expect(typeof logger.info).toBe('function')
      expect(() => logger.info('info message')).not.toThrow()
    })

    it('should have success method', () => {
      expect(typeof logger.success).toBe('function')
      expect(() => logger.success('success message')).not.toThrow()
    })

    it('should have warn method', () => {
      expect(typeof logger.warn).toBe('function')
      expect(() => logger.warn('warn message')).not.toThrow()
    })

    it('should have error method', () => {
      expect(typeof logger.error).toBe('function')
      expect(() => logger.error('error message')).not.toThrow()
    })

    it('should support message formatting with args', () => {
      expect(() => logger.info('message with %s', 'args')).not.toThrow()
    })
  })

  describe('Log level filtering', () => {
    it('should create logger with WARN level', () => {
      const logger = new Logger({ level: LogLevel.WARN })
      expect(() => {
        logger.debug('should not log')
        logger.info('should not log')
        logger.warn('should log')
      }).not.toThrow()
    })

    it('should create logger with DEBUG level', () => {
      const logger = new Logger({ level: LogLevel.DEBUG })
      expect(() => {
        logger.debug('debug')
        logger.info('info')
        logger.warn('warn')
      }).not.toThrow()
    })
  })

  describe('Timer functionality', () => {
    let logger: Logger

    beforeEach(() => {
      logger = new Logger()
    })

    it('should have time and timeEnd methods', () => {
      expect(typeof logger.time).toBe('function')
      expect(typeof logger.timeEnd).toBe('function')
    })

    it('should start and end timer without throwing', () => {
      expect(() => {
        logger.time('test-timer')
        logger.timeEnd('test-timer')
      }).not.toThrow()
    })

    it('should handle multiple timers', () => {
      expect(() => {
        logger.time('timer1')
        logger.time('timer2')
        logger.timeEnd('timer1')
        logger.timeEnd('timer2')
      }).not.toThrow()
    })
  })

  describe('Global logger functions', () => {
    it('should export global debug function', () => {
      expect(typeof debug).toBe('function')
      expect(() => debug('global debug')).not.toThrow()
    })

    it('should export global info function', () => {
      expect(typeof info).toBe('function')
      expect(() => info('global info')).not.toThrow()
    })

    it('should export global success function', () => {
      expect(typeof success).toBe('function')
      expect(() => success('global success')).not.toThrow()
    })

    it('should export global warn function', () => {
      expect(typeof warn).toBe('function')
      expect(() => warn('global warn')).not.toThrow()
    })

    it('should export global error function', () => {
      expect(typeof error).toBe('function')
      expect(() => error('global error')).not.toThrow()
    })

    it('should export global time functions', () => {
      expect(typeof time).toBe('function')
      expect(typeof timeEnd).toBe('function')
      expect(() => {
        time('global-timer')
        timeEnd('global-timer')
      }).not.toThrow()
    })
  })

  describe('Logger management', () => {
    it('should get and set logger', () => {
      const customLogger = new Logger({ name: 'custom' })
      setLogger(customLogger)
      const retrieved = getLogger()
      expect(retrieved).toBeInstanceOf(Logger)
    })

    it('should set and get log level', () => {
      setLevel(LogLevel.ERROR)
      const level = getLevel()
      expect(level).toBe(LogLevel.ERROR)
    })

    it('should check if level is enabled', () => {
      setLevel(LogLevel.WARN)
      expect(isLevelEnabled(LogLevel.DEBUG)).toBe(false)
      expect(isLevelEnabled(LogLevel.WARN)).toBe(true)
      expect(isLevelEnabled(LogLevel.ERROR)).toBe(true)
    })

    it('should set and get logger name', () => {
      setName('new-name')
      const name = getName()
      expect(name).toBe('new-name')
    })
  })
})
