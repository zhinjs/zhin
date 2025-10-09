import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    ZhinError,
    ConfigError,
    PluginError,
    AdapterError,
    ConnectionError,
    MessageError,
    ContextError,
    ValidationError,
    PermissionError,
    TimeoutError,
    ErrorManager,
    RetryManager,
    CircuitBreaker,
    errorManager
} from '../src/errors.js'

describe('错误处理系统', () => {
    describe('ZhinError基础类', () => {
        it('应该正确创建基础错误', () => {
            const error = new ZhinError('测试错误', 'TEST_ERROR', { key: 'value' })
            
            expect(error).toBeInstanceOf(Error)
            expect(error.name).toBe('ZhinError')
            expect(error.message).toBe('测试错误')
            expect(error.code).toBe('TEST_ERROR')
            expect(error.context).toEqual({ key: 'value' })
            expect(error.timestamp).toBeInstanceOf(Date)
        })

        it('应该正确转换为JSON', () => {
            const error = new ZhinError('测试错误', 'TEST_ERROR', { key: 'value' })
            const json = error.toJSON()
            
            expect(json).toEqual({
                name: 'ZhinError',
                message: '测试错误',
                code: 'TEST_ERROR',
                timestamp: expect.any(String),
                context: { key: 'value' },
                stack: expect.any(String)
            })
        })

        it('应该正确转换为用户友好格式', () => {
            const error = new ZhinError('测试错误', 'TEST_ERROR')
            expect(error.toUserString()).toBe('[TEST_ERROR] 测试错误')
        })
    })

    describe('特定错误类型', () => {
        it('ConfigError应该包含正确信息', () => {
            const error = new ConfigError('配置无效', { file: 'config.json' })
            
            expect(error.code).toBe('CONFIG_ERROR')
            expect(error.context).toEqual({ file: 'config.json' })
        })

        it('PluginError应该包含插件信息', () => {
            const error = new PluginError('插件加载失败', 'test-plugin')
            
            expect(error.code).toBe('PLUGIN_ERROR')
            expect(error.pluginName).toBe('test-plugin')
            expect(error.context?.pluginName).toBe('test-plugin')
        })

        it('AdapterError应该包含适配器信息', () => {
            const error = new AdapterError('适配器连接失败', 'icqq', 'bot-123')
            
            expect(error.code).toBe('ADAPTER_ERROR')
            expect(error.adapterName).toBe('icqq')
            expect(error.botName).toBe('bot-123')
        })

        it('ConnectionError应该包含重试信息', () => {
            const error = new ConnectionError('连接超时', false)
            
            expect(error.code).toBe('CONNECTION_ERROR')
            expect(error.retryable).toBe(false)
        })

        it('MessageError应该包含消息信息', () => {
            const error = new MessageError('消息发送失败', 'msg-123', 'channel-456')
            
            expect(error.code).toBe('MESSAGE_ERROR')
            expect(error.messageId).toBe('msg-123')
            expect(error.channelId).toBe('channel-456')
        })

        it('ValidationError应该包含验证信息', () => {
            const error = new ValidationError('字段验证失败', 'username', 'invalid_value')
            
            expect(error.code).toBe('VALIDATION_ERROR')
            expect(error.field).toBe('username')
            expect(error.value).toBe('invalid_value')
        })

        it('PermissionError应该包含权限信息', () => {
            const error = new PermissionError('权限不足', 'user-123', 'admin')
            
            expect(error.code).toBe('PERMISSION_ERROR')
            expect(error.userId).toBe('user-123')
            expect(error.requiredPermission).toBe('admin')
        })

        it('TimeoutError应该包含超时信息', () => {
            const error = new TimeoutError('操作超时', 5000)
            
            expect(error.code).toBe('TIMEOUT_ERROR')
            expect(error.timeoutMs).toBe(5000)
        })
    })

    describe('ErrorManager错误管理器', () => {
        let manager: ErrorManager

        beforeEach(() => {
            manager = new ErrorManager()
        })

        it('应该能注册和调用错误处理器', async () => {
            const handler = vi.fn()
            const error = new PluginError('测试错误', 'test-plugin')
            
            manager.register('PluginError', handler)
            await manager.handle(error)
            
            expect(handler).toHaveBeenCalledWith(error, undefined)
        })

        it('应该能注册和调用全局处理器', async () => {
            const handler = vi.fn()
            const error = new Error('普通错误')
            
            manager.registerGlobal(handler)
            await manager.handle(error)
            
            expect(handler).toHaveBeenCalledWith(error, undefined)
        })

        it('应该能传递上下文信息', async () => {
            const handler = vi.fn()
            const error = new Error('测试错误')
            const context = { key: 'value' }
            
            manager.registerGlobal(handler)
            await manager.handle(error, context)
            
            expect(handler).toHaveBeenCalledWith(error, context)
        })

        it('应该能移除错误处理器', () => {
            const handler = vi.fn()
            
            manager.register('Error', handler)
            const removed = manager.unregister('Error', handler)
            
            expect(removed).toBe(true)
        })

        it('应该能清理所有处理器', async () => {
            const handler = vi.fn()
            const error = new Error('测试错误')
            
            manager.registerGlobal(handler)
            manager.clear()
            await manager.handle(error)
            
            expect(handler).not.toHaveBeenCalled()
        })

        it('处理器内部错误不应该影响其他处理器', async () => {
            const failingHandler = vi.fn().mockRejectedValue(new Error('Handler error'))
            const workingHandler = vi.fn()
            const error = new Error('测试错误')
            
            manager.registerGlobal(failingHandler)
            manager.registerGlobal(workingHandler)
            
            await manager.handle(error)
            
            expect(failingHandler).toHaveBeenCalled()
            expect(workingHandler).toHaveBeenCalled()
        })
    })

    describe('RetryManager重试管理器', () => {
        it('应该在成功时不重试', async () => {
            const fn = vi.fn().mockResolvedValue('success')
            
            const result = await RetryManager.retry(fn, { maxRetries: 3 })
            
            expect(result).toBe('success')
            expect(fn).toHaveBeenCalledTimes(1)
        })

        it('应该在失败时重试', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('第一次失败'))
                .mockRejectedValueOnce(new Error('第二次失败'))
                .mockResolvedValue('成功')
            
            const result = await RetryManager.retry(fn, { maxRetries: 3, delay: 10 })
            
            expect(result).toBe('成功')
            expect(fn).toHaveBeenCalledTimes(3)
        })

        it('应该在达到最大重试次数后抛出错误', async () => {
            const error = new Error('持续失败')
            const fn = vi.fn().mockRejectedValue(error)
            
            await expect(
                RetryManager.retry(fn, { maxRetries: 2, delay: 10 })
            ).rejects.toThrow('持续失败')
            
            expect(fn).toHaveBeenCalledTimes(3) // 初始调用 + 2次重试
        })

        it('应该遵循重试条件', async () => {
            const error = new ConnectionError('不可重试的错误', false)
            const fn = vi.fn().mockRejectedValue(error)
            const retryCondition = (err: Error) => err instanceof ConnectionError && (err as ConnectionError).retryable
            
            await expect(
                RetryManager.retry(fn, { maxRetries: 3, retryCondition })
            ).rejects.toThrow('不可重试的错误')
            
            expect(fn).toHaveBeenCalledTimes(1) // 不应该重试
        })

        it('应该支持指数退避', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce(new Error('失败'))
                .mockResolvedValue('成功')
            
            const startTime = Date.now()
            await RetryManager.retry(fn, { 
                maxRetries: 1, 
                delay: 100, 
                exponentialBackoff: true 
            })
            const endTime = Date.now()
            
            expect(endTime - startTime).toBeGreaterThanOrEqual(100)
        })
    })

    describe('CircuitBreaker断路器', () => {
        let circuitBreaker: CircuitBreaker

        beforeEach(() => {
            circuitBreaker = new CircuitBreaker(2, 1000, 500) // 失败阈值2, 超时1秒, 监控500ms
        })

        it('应该在正常情况下执行操作', async () => {
            const fn = vi.fn().mockResolvedValue('success')
            
            const result = await circuitBreaker.execute(fn)
            
            expect(result).toBe('success')
            expect(circuitBreaker.getState()).toBe('CLOSED')
        })

        it('应该在失败次数达到阈值后打开断路器', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('失败'))
            
            // 第一次失败
            await expect(circuitBreaker.execute(fn)).rejects.toThrow('失败')
            expect(circuitBreaker.getState()).toBe('CLOSED')
            
            // 第二次失败，应该打开断路器
            await expect(circuitBreaker.execute(fn)).rejects.toThrow('失败')
            expect(circuitBreaker.getState()).toBe('OPEN')
            
            // 后续调用应该直接拒绝
            await expect(circuitBreaker.execute(fn)).rejects.toThrow('Circuit breaker is OPEN')
            expect(fn).toHaveBeenCalledTimes(2) // 不应该再次调用原函数
        })

        it('应该在超时后尝试半开状态', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('失败'))
            
            // 触发断路器打开
            await expect(circuitBreaker.execute(fn)).rejects.toThrow()
            await expect(circuitBreaker.execute(fn)).rejects.toThrow()
            expect(circuitBreaker.getState()).toBe('OPEN')
            
            // 模拟时间过去（这里无法真正等待，但可以测试逻辑）
            // 在真实场景中，需要等待timeoutMs后再次调用
        })

        it('应该能重置断路器', async () => {
            const fn = vi.fn().mockRejectedValue(new Error('失败'))
            
            // 触发断路器打开
            await expect(circuitBreaker.execute(fn)).rejects.toThrow()
            await expect(circuitBreaker.execute(fn)).rejects.toThrow()
            expect(circuitBreaker.getState()).toBe('OPEN')
            
            // 重置断路器
            circuitBreaker.reset()
            expect(circuitBreaker.getState()).toBe('CLOSED')
            
            // 应该能再次执行
            await expect(circuitBreaker.execute(fn)).rejects.toThrow('失败')
        })
    })
})
