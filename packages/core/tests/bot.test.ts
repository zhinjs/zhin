import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Bot } from '../src/bot'
import type { BotConfig, SendOptions } from '../src/types'

describe('Bot接口测试', () => {
  // 创建一个测试用的Bot实现类
  class TestBot implements Bot {
    connected = false

    constructor(public config: BotConfig) {}

    async connect(): Promise<void> {
      this.connected = true
    }

    async disconnect(): Promise<void> {
      this.connected = false
    }

    async sendMessage(options: SendOptions): Promise<void> {
      if (!this.connected) {
        throw new Error('机器人未连接')
      }
      // 模拟发送消息
    }
  }

  let bot: TestBot
  let testConfig: BotConfig

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
      await bot.connect()
      expect(bot.connected).toBe(true)
    })

    it('应该正确处理断开连接', async () => {
      await bot.connect()
      await bot.disconnect()
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

      await expect(bot.sendMessage(options)).rejects.toThrow('机器人未连接')
    })

    it('连接后应该正确发送消息', async () => {
      const options: SendOptions = {
        id: '123',
        type: 'group',
        context: 'test',
        bot: 'test-bot',
        content: '测试消息'
      }

      const sendSpy = vi.spyOn(bot, 'sendMessage')
      await bot.connect()
      await bot.sendMessage(options)
      expect(sendSpy).toHaveBeenCalledWith(options)
    })
  })

  describe('自定义配置测试', () => {
    it('应该支持扩展的配置类型', () => {
      interface ExtendedConfig extends BotConfig {
        token: string
        platform: string
      }

      class ExtendedBot implements Bot<ExtendedConfig> {
        connected = false

        constructor(public config: ExtendedConfig) {}

        async connect(): Promise<void> {
          this.connected = true
        }

        async disconnect(): Promise<void> {
          this.connected = false
        }

        async sendMessage(options: SendOptions): Promise<void> {
          if (!this.connected) {
            throw new Error('机器人未连接')
          }
          // 模拟发送消息
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
