import { describe, it, expect } from 'vitest'
import { ZhinError } from '../src/errors.js'

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
})
