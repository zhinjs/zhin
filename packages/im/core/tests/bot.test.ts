import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Bot } from '../src/bot'
import type {SendOptions } from '../src/types'
import { Message } from '../src/message'

describe('Bot接口测试', () => {
  // 创建一个测试用的Bot实现类
  class TestBot implements Bot<any, Bot.Config> {
    connected = false
    $config: Bot.Config
    constructor(public config: Bot.Config) {
      this.$config = config
    }

    async $connect(): Promise<void> {
      this.connected = true
    }

    async $disconnect(): Promise<void> {
      this.connected = false
    }

    async $sendMessage(options: SendOptions): Promise<string> {
      if (!this.connected) {
        throw new Error('机器人未连接')
      }
      // 模拟发送消息
      return '123'
    }
    async $recallMessage(id: string): Promise<void> {
      // 模拟撤回消息
    }
    $formatMessage(message: any): Message<any> {
      return message
    }
  }

  let bot: TestBot
  let testConfig: Bot.Config

  beforeEach(() => {
    testConfig = {
      name: '测试机器人',
      context: 'test'
    }
    bot = new TestBot(testConfig)
  })

  describe('基本属性测试', () => {
    it('应该正确设置配置', () => {
      expect(bot.config).toEqual(testConfig)
    })

    it('应该正确初始化连接状态', () => {
      expect(bot.connected).toBe(false)
    })
  })

  describe('连接管理测试', () => {
    it('应该正确处理连接', async () => {
      await bot.$connect()
      expect(bot.connected).toBe(true)
    })

    it('应该正确处理断开连接', async () => {
      await bot.$connect()
      await bot.$disconnect()
      expect(bot.connected).toBe(false)
    })
  })

  describe('消息发送测试', () => {
    it('未连接时应该抛出错误', async () => {
      const options: SendOptions = {
        id: '123',
        type: 'group',
        context: 'test',
        bot: 'test-bot',
        content: '测试消息'
      }

      await expect(bot.$sendMessage(options)).rejects.toThrow('机器人未连接')
    })

    it('连接后应该正确发送消息', async () => {
      const options: SendOptions = {
        id: '123',
        type: 'group',
        context: 'test',
        bot: 'test-bot',
        content: '测试消息'
      }

      const sendSpy = vi.spyOn(bot, '$sendMessage')
      await bot.$connect()
      await bot.$sendMessage(options)
      expect(sendSpy).toHaveBeenCalledWith(options)
    })
  })

  describe('自定义配置测试', () => {
    it('应该支持扩展的配置类型', () => {
      interface ExtendedConfig extends Bot.Config {
        token: string
        platform: string
      }

      class ExtendedBot implements Bot<ExtendedConfig> {
        connected = false
        $config: ExtendedConfig
        constructor(public config: ExtendedConfig) {
          this.$config = config
        }

        async $connect(): Promise<void> {
          this.connected = true
        }

        async $disconnect(): Promise<void> {
          this.connected = false
        }

        async $sendMessage(options: SendOptions): Promise<string> {
          if (!this.connected) {
            throw new Error('机器人未连接')
          }
          return '123'
          // 模拟发送消息
        }
        async $recallMessage(id: string): Promise<void> {
          // 模拟撤回消息
        }
        $formatMessage(message: any): Message<any> {
          return message
        }
      }

      const extendedConfig: ExtendedConfig = {
        name: '扩展机器人',
        context: 'extended',
        token: 'test-token',
        platform: 'test-platform'
      }

      const extendedBot = new ExtendedBot(extendedConfig)
      expect(extendedBot.config).toEqual(extendedConfig)
      expect(extendedBot.config.token).toBe('test-token')
      expect(extendedBot.config.platform).toBe('test-platform')
    })
  })
})
