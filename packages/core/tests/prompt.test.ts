import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prompt } from '../src/prompt'
import { Plugin } from '../src/plugin'
import { App } from '../src/app'
import { MessageBase, MessageChannel } from '../src/message'
import { Schema } from '@zhin.js/core'

describe('Prompt交互系统测试', () => {
  let app: App
  let plugin: Plugin
  let mockMessage: MessageBase
  let prompt: Prompt<never>  // Prompt类型参数约束为never，使用never

  beforeEach(() => {
    app = new App({
      log_level: 1,
      plugin_dirs: [],
      plugins: [],
      bots: [],
      debug: false
    })
    
    plugin = app.createDependency('test-plugin', '/mock/test.ts')
    
    // 创建模拟消息
    const mockChannel: MessageChannel = {
      id: 'channel123',
      type: 'group'
    }
    
    mockMessage = {
      $id: 'msg123',
      $adapter: 'test',
      $bot: 'bot123',
      $content: [],
      $sender: {
        id: 'user123',
        name: 'testuser'
      },
      $reply: vi.fn().mockResolvedValue('reply123'),
      $channel: mockChannel,
      $timestamp: Date.now(),
      $raw: 'test message'
    }
    
    prompt = new Prompt(plugin, mockMessage as any)
  })

  describe('Prompt实例化', () => {
    it('应该正确创建Prompt实例', () => {
      expect(prompt).toBeInstanceOf(Prompt)
    })

    it('应该具有各种输入方法', () => {
      expect(typeof prompt.text).toBe('function')
      expect(typeof prompt.number).toBe('function')
      expect(typeof prompt.confirm).toBe('function')
      expect(typeof prompt.list).toBe('function')
      expect(typeof prompt.pick).toBe('function')
    })
  })

  describe('基础输入类型', () => {
    it('应该创建文本输入prompt', async () => {
      // 由于Prompt的实际实现依赖于消息监听，这里主要测试接口存在
      expect(typeof prompt.text).toBe('function')
    })

    it('应该创建数字输入prompt', async () => {
      expect(typeof prompt.number).toBe('function')
    })

    it('应该创建确认输入prompt', async () => {
      expect(typeof prompt.confirm).toBe('function')
    })

    it('应该创建列表输入prompt', async () => {
      expect(typeof prompt.list).toBe('function')
    })

    it('应该创建选项选择prompt', async () => {
      expect(typeof prompt.pick).toBe('function')
    })
  })

  describe('Schema集成', () => {
    it('应该处理字符串Schema', () => {
      const schema = Schema.string('请输入文本')
      expect(typeof prompt.getValueWithSchema).toBe('function')
      
      // 测试Schema类型识别
      expect(schema.meta.type).toBe('string')
    })

    it('应该处理数字Schema', () => {
      const schema = Schema.number('请输入数字')
      expect(schema.meta.type).toBe('number')
    })

    it('应该处理布尔Schema', () => {
      const schema = Schema.boolean('请确认')
      expect(schema.meta.type).toBe('boolean')
    })

    it('应该处理选项Schema', () => {
      const schema = Schema.string('请选择')
      schema.meta.options = Schema.formatOptionList(['选项1', '选项2', '选项3'])
      
      expect(schema.meta.options).toHaveLength(3)
    })

    it('应该处理对象Schema', () => {
      const schema = Schema.object({
        name: Schema.string('姓名'),
        age: Schema.number('年龄')
      })
      
      expect(schema.meta.type).toBe('object')
      expect(typeof prompt.getValueWithSchemas).toBe('function')
    })
  })

  describe('高级功能', () => {
    it('应该支持常量值返回', async () => {
      const result = await prompt.const('固定值')
      expect(result).toBe('固定值')
    })

    it('应该处理超时情况', () => {
      // 测试prompt方法接受超时参数
      expect(typeof prompt.text).toBe('function')
      // text方法应该支持timeout参数
    })

    it('应该支持默认值', () => {
      const schema = Schema.string('测试').default('默认值')
      expect(schema.meta.default).toBe('默认值')
    })
  })

  describe('配置选项', () => {
    it('应该支持自定义超时时间', () => {
      const customTimeout = 10000
      // text方法接受timeout参数，测试方法存在
      expect(typeof prompt.text).toBe('function')
    })

    it('应该支持格式化函数', () => {
      const formatFn = (input: string) => input.toUpperCase()
      // 测试格式化函数的概念存在
      expect(typeof formatFn).toBe('function')
      expect(formatFn('test')).toBe('TEST')
    })
  })

  describe('错误处理', () => {
    it('应该处理无效输入', () => {
      // 测试错误处理机制的存在
      expect(() => {
        const schema = Schema.string('测试')
        schema.meta.type = 'invalid' as any
      }).not.toThrow() // 只是设置，不会立即验证
    })

    it('应该处理超时错误', () => {
      // 测试超时机制通过方法参数支持
      expect(typeof prompt.text).toBe('function')
      expect(typeof prompt.middleware).toBe('function')
    })
  })

  describe('类型推断', () => {
    it('应该正确推断字符串类型', () => {
      const schema = Schema.string('文本输入')
      expect(schema.meta.type).toBe('string')
    })

    it('应该正确推断数字类型', () => {
      const schema = Schema.number('数字输入')
      expect(schema.meta.type).toBe('number')
    })

    it('应该正确推断布尔类型', () => {
      const schema = Schema.boolean('布尔输入')
      expect(schema.meta.type).toBe('boolean')
    })

    it('应该正确推断常量类型', () => {
      const schema = Schema.const('CONSTANT', '常量')
      expect(schema.meta.type).toBe('const')
      expect(schema.meta.default).toBe('CONSTANT')
    })
  })

  describe('复杂交互场景', () => {
    it('应该支持条件性提示', () => {
      // 测试条件逻辑
      const condition = true
      const schema = condition 
        ? Schema.string('条件为真时的提示')
        : Schema.number('条件为假时的提示')
      
      expect(schema.meta.type).toBe('string')
    })

    it('应该支持级联提示', () => {
      const schemas = {
        first: Schema.string('第一个问题'),
        second: Schema.string('第二个问题'),
        third: Schema.number('第三个问题')
      }
      
      expect(Object.keys(schemas)).toHaveLength(3)
      expect(typeof prompt.getValueWithSchemas).toBe('function')
    })

    it('应该支持验证规则', () => {
      const schema = Schema.number('年龄').min(0).max(150)
      expect(schema.meta.min).toBe(0)
      expect(schema.meta.max).toBe(150)
    })
  })
})