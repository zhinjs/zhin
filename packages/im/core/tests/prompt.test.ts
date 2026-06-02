import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prompt } from '../src/prompt'
import { Plugin } from '../src/plugin'
import { Schema } from '@zhin.js/schema'

describe('Prompt', () => {
  let plugin: Plugin
  let mockEvent: any
  let prompt: Prompt<any>

  beforeEach(() => {
    plugin = new Plugin('/test/plugin.ts')
    
    // 创建模拟事件
    mockEvent = {
      $adapter: 'test-adapter',
      $bot: 'test-bot',
      $channel: { type: 'text', id: 'test-channel' },
      $sender: { id: 'test-user' },
      $raw: 'test message',
      $reply: vi.fn().mockResolvedValue('message-id')
    }

    prompt = new Prompt(plugin, mockEvent as any)
  })

  describe('Constructor', () => {
    it('should create Prompt instance', () => {
      expect(prompt).toBeInstanceOf(Prompt)
    })
  })

  describe('const', () => {
    it('should return constant value', async () => {
      const result = await prompt.const(42)
      expect(result).toBe(42)
    })

    it('should return constant string', async () => {
      const result = await prompt.const('test-value')
      expect(result).toBe('test-value')
    })

    it('should return constant object', async () => {
      const obj = { key: 'value' }
      const result = await prompt.const(obj)
      expect(result).toBe(obj)
    })

    it('should return constant array', async () => {
      const arr = [1, 2, 3]
      const result = await prompt.const(arr)
      expect(result).toBe(arr)
    })
  })

  describe('Schema error handling', () => {
    it('should throw error for unsupported list inner type', async () => {
      const schema = Schema.list(Schema.object({})).description('不支持的列表类型')
      
      await expect(prompt.getValueWithSchema(schema)).rejects.toThrow('unsupported inner type')
    })

    it('should throw error for unsupported schema type', async () => {
      const schema = Schema.dict(Schema.string()).description('不支持的类型')
      
      await expect(prompt.getValueWithSchema(schema)).rejects.toThrow('Unsupported schema input type')
    })

    it('should throw error for object schema without object definition', async () => {
      const schema = Schema.object({})
      // 删除 object 定义来触发错误
      delete (schema as any).options.object
      
      await expect(prompt.getValueWithSchema(schema)).rejects.toThrow('Object schema missing object definition')
    })
  })
})
