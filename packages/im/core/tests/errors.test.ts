/**
 * Core 特有的错误类型测试（通用错误测试已迁移到 @zhin.js/kernel）
 */
import { describe, it, expect } from 'vitest'
import { AdapterError, MessageError } from '../src/errors.js'

describe('Core 特有错误类型', () => {
    it('AdapterError应该包含适配器信息', () => {
        const error = new AdapterError('适配器连接失败', 'icqq', 'bot-123')
        expect(error.code).toBe('ADAPTER_ERROR')
        expect(error.adapterName).toBe('icqq')
        expect(error.botName).toBe('bot-123')
    })

    it('MessageError应该包含消息信息', () => {
        const error = new MessageError('消息发送失败', 'msg-123', 'channel-456')
        expect(error.code).toBe('MESSAGE_ERROR')
        expect(error.messageId).toBe('msg-123')
        expect(error.channelId).toBe('channel-456')
    })
})
