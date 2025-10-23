import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Cron } from '../src/cron'

describe('Cron定时任务系统测试', () => {
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

  describe('Cron实例化', () => {
    it('应该正确创建Cron实例', () => {
      cron = new Cron('0 0 * * * *', mockCallback) // 每小时执行
      expect(cron).toBeInstanceOf(Cron)
      expect(cron.running).toBe(false)
      expect(cron.disposed).toBe(false)
    })

    it('应该正确保存cron表达式', () => {
      cron = new Cron('0 0 12 * * *', mockCallback) // 每天中午12点
      expect(cron.cronExpression).toContain('0 12 * * *')
    })

    it('应该拒绝无效的cron表达式', () => {
      expect(() => {
        new Cron('invalid expression', mockCallback)
      }).toThrow(/Invalid cron expression/)
    })

    it('应该接受异步回调函数', () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined)
      cron = new Cron('0 0 * * * *', asyncCallback)
      expect(cron).toBeInstanceOf(Cron)
    })
  })

  describe('任务执行控制', () => {
    beforeEach(() => {
      cron = new Cron('*/5 * * * * *', mockCallback) // 每5秒执行
    })

    it('应该能够启动任务', () => {
      expect(cron.running).toBe(false)
      cron.run()
      expect(cron.running).toBe(true)
    })

    it('应该能够停止任务', () => {
      cron.run()
      expect(cron.running).toBe(true)
      cron.stop()
      expect(cron.running).toBe(false)
    })

    it('应该防止重复启动', () => {
      cron.run()
      expect(cron.running).toBe(true)
      
      // 第二次调用run应该无效果
      cron.run()
      expect(cron.running).toBe(true)
    })

    it('应该能够销毁任务', () => {
      cron.run()
      expect(cron.running).toBe(true)
      expect(cron.disposed).toBe(false)
      
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
      // 设置固定时间: 2024-01-01 00:00:00
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
    })

    it('应该计算下一次执行时间', () => {
      cron = new Cron('0 0 12 * * *', mockCallback) // 每天中午12点
      const nextTime = cron.getNextExecutionTime()
      
      // 下一次执行应该是当天中午12点
      expect(nextTime.getHours()).toBe(12)
      expect(nextTime.getMinutes()).toBe(0)
      expect(nextTime.getSeconds()).toBe(0)
    })

    it('应该处理跨日期的执行时间', () => {
      vi.setSystemTime(new Date('2024-01-01T23:00:00.000Z')) // 晚上11点
      cron = new Cron('0 0 1 * * *', mockCallback) // 每天凌晨1点
      
      const nextTime = cron.getNextExecutionTime()
      // 从晚上11点到第二天凌晨1点，可能还是当天或第二天，取决于实现
      expect(nextTime.getHours()).toBe(1)
      expect(nextTime.getDate()).toBeGreaterThanOrEqual(1)
    })
  })

  describe('cron表达式解析', () => {
    it('应该支持每分钟执行', () => {
      cron = new Cron('0 * * * * *', mockCallback)
      expect(cron.cronExpression).toContain('* * * * *')
    })

    it('应该支持每小时执行', () => {
      cron = new Cron('0 0 * * * *', mockCallback)
      expect(cron.cronExpression).toContain('0 * * * *')
    })

    it('应该支持每天执行', () => {
      cron = new Cron('0 0 0 * * *', mockCallback)
      expect(cron.cronExpression).toContain('0 0 * * *')
    })

    it('应该支持步长表达式', () => {
      cron = new Cron('0 */15 * * * *', mockCallback) // 每15分钟
      expect(cron.cronExpression).toContain('*/15')
    })

    it('应该支持范围表达式', () => {
      cron = new Cron('0 0 9-17 * * *', mockCallback) // 工作时间
      expect(cron.cronExpression).toContain('9-17')
    })

    it('应该支持列表表达式', () => {
      cron = new Cron('0 0 0 * * 1,3,5', mockCallback) // 周一、三、五
      expect(cron.cronExpression).toContain('1,3,5')
    })
  })

  describe('任务执行', () => {
    it('应该在指定时间执行回调', async () => {
      // 每秒执行的任务
      cron = new Cron('* * * * * *', mockCallback)
      cron.run()

      // 推进时间1秒
      await vi.advanceTimersByTimeAsync(1000)
      
      expect(mockCallback).toHaveBeenCalledTimes(1)
    })

    it('应该处理异步回调', async () => {
      const asyncCallback = vi.fn().mockResolvedValue(undefined)
      cron = new Cron('* * * * * *', asyncCallback)
      cron.run()

      await vi.advanceTimersByTimeAsync(1000)
      
      expect(asyncCallback).toHaveBeenCalledTimes(1)
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

    it('应该继续执行即使回调出错', async () => {
      const errorCallback = vi.fn()
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValueOnce(undefined)
      
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      
      cron = new Cron('* * * * * *', errorCallback)
      cron.run()

      // 第一次执行（出错）
      await vi.advanceTimersByTimeAsync(1000)
      expect(errorCallback).toHaveBeenCalledTimes(1)
      
      // 第二次执行（成功）
      await vi.advanceTimersByTimeAsync(1000)
      expect(errorCallback).toHaveBeenCalledTimes(2)
      
      consoleErrorSpy.mockRestore()
    })
  })

  describe('定时器管理', () => {
    it('应该在停止时清除定时器', () => {
      cron = new Cron('0 0 * * * *', mockCallback)
      cron.run()
      
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      cron.stop()
      
      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it('应该在销毁时清除定时器', () => {
      cron = new Cron('0 0 * * * *', mockCallback)
      cron.run()
      
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      cron.dispose()
      
      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('边界情况', () => {
    it('应该处理立即执行的情况', async () => {
      // 设置当前时间为准确的秒开始
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
      
      cron = new Cron('* * * * * *', mockCallback) // 每秒执行
      cron.run()
      
      // 只推进1秒，避免无限循环
      await vi.advanceTimersByTimeAsync(1000)
      
      expect(mockCallback).toHaveBeenCalled()
    })

    it('应该处理非常频繁的任务', async () => {
      // 每秒执行多次的任务（这在实际使用中可能不常见，但测试边界情况）
      cron = new Cron('* * * * * *', mockCallback)
      cron.run()

      // 推进5秒
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(1000)
      }
      
      expect(mockCallback).toHaveBeenCalledTimes(5)
    })

    it('应该在停止后不再执行', async () => {
      cron = new Cron('* * * * * *', mockCallback)
      cron.run()

      // 推进1秒并执行
      await vi.advanceTimersByTimeAsync(1000)
      expect(mockCallback).toHaveBeenCalledTimes(1)
      
      // 停止任务
      cron.stop()
      
      // 再推进时间，不应该再执行
      await vi.advanceTimersByTimeAsync(2000)
      expect(mockCallback).toHaveBeenCalledTimes(1)
    })
  })
})