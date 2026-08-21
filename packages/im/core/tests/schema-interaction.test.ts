import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SchemaInteraction } from '../src/schema-interaction'
import { Plugin } from '../src/plugin'
import { Schema } from '@zhin.js/schema'

describe('SchemaInteraction', () => {
  let plugin: Plugin
  let mockEvent: any
  let interaction: SchemaInteraction<any>

  beforeEach(() => {
    plugin = new Plugin('/test/plugin.ts')
    
    // 创建模拟事件
    mockEvent = {
      $adapter: 'test-adapter',
      $endpoint: 'test-bot',
      $channel: { type: 'text', id: 'test-channel' },
      $sender: { id: 'test-user' },
      $raw: 'test message',
      $reply: vi.fn().mockResolvedValue('message-id')
    }

    interaction = new SchemaInteraction(plugin, mockEvent as any)
  })

  describe('Constructor', () => {
    it('should create SchemaInteraction instance', () => {
      expect(interaction).toBeInstanceOf(SchemaInteraction)
    })
  })

  describe('const', () => {
    it('should return constant value', async () => {
      const result = await interaction.const(42)
      expect(result).toBe(42)
    })

    it('should return constant string', async () => {
      const result = await interaction.const('test-value')
      expect(result).toBe('test-value')
    })

    it('should return constant object', async () => {
      const obj = { key: 'value' }
      const result = await interaction.const(obj)
      expect(result).toBe(obj)
    })

    it('should return constant array', async () => {
      const arr = [1, 2, 3]
      const result = await interaction.const(arr)
      expect(result).toBe(arr)
    })
  })

  describe('Schema error handling', () => {
    it('should throw error for unsupported list inner type', async () => {
      const schema = Schema.list(Schema.object({})).description('不支持的列表类型')
      
      await expect(interaction.getValueWithSchema(schema)).rejects.toThrow('unsupported inner type')
    })

    it('should throw error for unsupported schema type', async () => {
      const schema = Schema.dict(Schema.string()).description('不支持的类型')
      
      await expect(interaction.getValueWithSchema(schema)).rejects.toThrow('Unsupported schema input type')
    })

    it('should throw error for object schema without object definition', async () => {
      const schema = Schema.object({})
      // 删除 object 定义来触发错误
      delete (schema as any).options.object
      
      await expect(interaction.getValueWithSchema(schema)).rejects.toThrow('Object schema missing object definition')
    })
  })
})
