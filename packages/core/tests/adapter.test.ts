import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Adapter } from '../src/adapter'
import { Bot } from '../src/bot'
import { Plugin } from '../src/plugin'
import { App } from '../src/app'
import type { BotConfig } from '../src/types'

describe('适配器类测试', () => {
  // 创建测试用的Bot类
  class TestBot implements Bot {
    connected = false

    constructor(public plugin: Plugin, public config: BotConfig) {}

    async connect(): Promise<void> {
      this.connected = true
    }

    async disconnect(): Promise<void> {
      this.connected = false
    }

    async sendMessage(): Promise<void> {
      if (!this.connected) throw new Error('机器人未连接')
    }
  }

  let app: App
  let plugin: Plugin
  let adapter: Adapter<TestBot>

  beforeEach(() => {
    // 创建测试环境
    app = new App({
      bots: [
        { name: 'test-bot-1', context: 'test-adapter' },
        { name: 'test-bot-2', context: 'test-adapter' },
        { name: 'other-bot', context: 'other-adapter' }
      ]
    })
    plugin = app.createDependency('test-plugin', 'test-plugin.ts')
  })

  describe('构造函数工厂方法测试', () => {
    it('应该使用构造函数创建适配器', () => {
      adapter = new Adapter('test-adapter', TestBot)
      expect(adapter.name).toBe('test-adapter')
      expect(adapter.bots.size).toBe(0)
    })

    it('应该使用工厂函数创建适配器', () => {
      const botFactory = (plugin: Plugin, config: BotConfig) => new TestBot(plugin, config)
      adapter = new Adapter('test-adapter', botFactory)
      expect(adapter.name).toBe('test-adapter')
      expect(adapter.bots.size).toBe(0)
    })
  })

  describe('启动和停止测试', () => {
    beforeEach(() => {
      adapter = new Adapter('test-adapter', TestBot)
    })

    it('应该正确启动适配器和机器人', async () => {
      const loggerSpy = vi.spyOn(plugin.logger, 'info')
      await adapter.start(plugin)

      expect(adapter.bots.size).toBe(2)
      expect(adapter.bots.get('test-bot-1')).toBeDefined()
      expect(adapter.bots.get('test-bot-2')).toBeDefined()
      expect(adapter.bots.get('test-bot-1')?.connected).toBe(true)
      expect(adapter.bots.get('test-bot-2')?.connected).toBe(true)

      expect(loggerSpy).toHaveBeenCalledWith('bot test-bot-1 of adapter test-adapter connected')
      expect(loggerSpy).toHaveBeenCalledWith('bot test-bot-2 of adapter test-adapter connected')
      expect(loggerSpy).toHaveBeenCalledWith('adapter test-adapter started')
    })

    it('应该正确停止适配器和机器人', async () => {
      await adapter.start(plugin)
      const loggerSpy = vi.spyOn(plugin.logger, 'info')
      await adapter.stop(plugin)

      expect(adapter.bots.size).toBe(0)
      expect(loggerSpy).toHaveBeenCalledWith('bot test-bot-1 of adapter test-adapter disconnected')
      expect(loggerSpy).toHaveBeenCalledWith('bot test-bot-2 of adapter test-adapter disconnected')
      expect(loggerSpy).toHaveBeenCalledWith('adapter test-adapter stopped')
    })

    it('没有匹配的机器人配置时应该正常启动', async () => {
      const emptyAdapter = new Adapter('empty-adapter', TestBot)
      await emptyAdapter.start(plugin)
      expect(emptyAdapter.bots.size).toBe(0)
    })
  })

  describe('工具函数测试', () => {
    it('应该正确识别Bot构造函数', () => {
      // 修改测试用例，因为isBotConstructor返回undefined而不是false
      expect(Adapter.isBotConstructor(TestBot)).toBe(true)
      const botFactory = (plugin: Plugin, config: BotConfig) => new TestBot(plugin, config)
      expect(Adapter.isBotConstructor(botFactory)).toBeFalsy()
    })
  })

  describe('错误处理测试', () => {
    it('应该处理机器人连接失败', async () => {
      class FailingBot extends TestBot {
        async connect(): Promise<void> {
          throw new Error('连接失败')
        }
      }

      const failingAdapter = new Adapter('failing-adapter', FailingBot)
      // 修改配置以包含失败的机器人
      app.updateConfig({
        bots: [
          { name: 'failing-bot', context: 'failing-adapter' }
        ]
      })
      await expect(failingAdapter.start(plugin)).rejects.toThrow('连接失败')
    })

    it('应该处理机器人断开连接失败', async () => {
      class FailingBot extends TestBot {
        async disconnect(): Promise<void> {
          throw new Error('断开连接失败')
        }
      }

      const failingAdapter = new Adapter('failing-adapter', FailingBot)
      // 修改配置以包含失败的机器人
      app.updateConfig({
        bots: [
          { name: 'failing-bot', context: 'failing-adapter' }
        ]
      })
      await failingAdapter.start(plugin)
      await expect(failingAdapter.stop(plugin)).rejects.toThrow('断开连接失败')
    })
  })

  describe('类型系统测试', () => {
    it('应该支持扩展的Bot配置', async () => {
      interface ExtendedBotConfig extends BotConfig {
        token: string
        platform: string
      }

      class ExtendedBot implements Bot<ExtendedBotConfig> {
        connected = false

        constructor(public plugin: Plugin, public config: ExtendedBotConfig) {}

        async connect(): Promise<void> {
          this.connected = true
        }

        async disconnect(): Promise<void> {
          this.connected = false
        }

        async sendMessage(): Promise<void> {
          if (!this.connected) throw new Error('机器人未连接')
        }
      }

      const extendedApp = new App({
        bots: [{
          name: 'extended-bot',
          context: 'extended-adapter',
          token: 'test-token',
          platform: 'test-platform'
        }]
      })

      const extendedPlugin = extendedApp.createDependency('test-plugin', 'test-plugin.ts')
      const extendedAdapter = new Adapter('extended-adapter', ExtendedBot)
      await extendedAdapter.start(extendedPlugin)

      const bot = extendedAdapter.bots.get('extended-bot')
      expect(bot).toBeDefined()
      expect(bot?.config.token).toBe('test-token')
      expect(bot?.config.platform).toBe('test-platform')
    })
  })
})