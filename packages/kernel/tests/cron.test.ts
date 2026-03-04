/**
 * Cron 类测试（从 core/tests/cron.test.ts 拆分出 Cron 部分）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Cron } from '../src/cron'

describe('Cron定时任务', () => {
  let mockCallback: () => void | Promise<void>
  let cron: Cron

  beforeEach(() => {
    vi.useFakeTimers()
    mockCallback = vi.fn()
  })

  afterEach(() => {
    if (cron && !cron.disposed) {
      cron.dispose()
    }
    vi.useRealTimers()
  })

  describe('实例化', () => {
    it('应该正确创建Cron实例', () => {
      cron = new Cron('0 0 * * * *', mockCallback)
      expect(cron).toBeInstanceOf(Cron)
      expect(cron.running).toBe(false)
      expect(cron.disposed).toBe(false)
    })

    it('应该正确保存cron表达式', () => {
      cron = new Cron('0 0 12 * * *', mockCallback)
      expect(cron.cronExpression).toContain('0 12 * * *')
    })

    it('应该拒绝无效的cron表达式', () => {
      expect(() => new Cron('invalid expression', mockCallback)).toThrow(/Invalid cron expression/)
    })
  })

  describe('执行控制', () => {
    beforeEach(() => {
      cron = new Cron('*/5 * * * * *', mockCallback)
    })

    it('应该能够启动任务', () => {
      cron.run()
      expect(cron.running).toBe(true)
    })

    it('应该能够停止任务', () => {
      cron.run()
      cron.stop()
      expect(cron.running).toBe(false)
    })

    it('应该防止重复启动', () => {
      cron.run()
      cron.run()
      expect(cron.running).toBe(true)
    })

    it('应该能够销毁任务', () => {
      cron.run()
      cron.dispose()
      expect(cron.running).toBe(false)
      expect(cron.disposed).toBe(true)
    })

    it('应该拒绝操作已销毁的任务', () => {
      cron.dispose()
      expect(() => cron.run()).toThrow(/Cannot run a disposed cron job/)
      expect(() => cron.getNextExecutionTime()).toThrow(/Cannot get next execution time for a disposed cron job/)
    })
  })

  describe('时间计算', () => {
    beforeEach(() => {
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    })

    it('应该计算下一次执行时间', () => {
      cron = new Cron('0 0 12 * * *', mockCallback)
      const nextTime = cron.getNextExecutionTime()
      expect(nextTime.getHours()).toBe(12)
      expect(nextTime.getMinutes()).toBe(0)
    })
  })

  describe('任务执行', () => {
    it('应该在指定时间执行回调', async () => {
      cron = new Cron('* * * * * *', mockCallback)
      cron.run()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockCallback).toHaveBeenCalledTimes(1)
    })

    it('应该处理回调中的错误', async () => {
      const errorCallback = vi.fn().mockRejectedValue(new Error('Test error'))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      cron = new Cron('* * * * * *', errorCallback)
      cron.run()
      await vi.advanceTimersByTimeAsync(1000)
      expect(errorCallback).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error executing cron callback')
      )
      consoleErrorSpy.mockRestore()
    })

    it('应该在停止后不再执行', async () => {
      cron = new Cron('* * * * * *', mockCallback)
      cron.run()
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockCallback).toHaveBeenCalledTimes(1)
      cron.stop()
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockCallback).toHaveBeenCalledTimes(1)
    })
  })
})
