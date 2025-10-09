import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { App, createApp } from '../src/app'
import { AppConfig } from '../src/types'
import { Plugin } from '../src/plugin'
import { Adapter } from '../src/adapter'
import { TestLogger } from './test-utils'
import path from 'path'
import fs from 'fs'

describe('App类测试', () => {
  let app: App
  let testConfig: AppConfig
  let testPluginDir: string

  beforeEach(() => {
    // 设置测试配置
    testConfig = {
      plugin_dirs: ['./test-plugins'],
      plugins: [],
      bots: [],
      debug: true
    }

    // 创建测试插件目录
    testPluginDir = path.join(process.cwd(), 'test-plugins')
    if (!fs.existsSync(testPluginDir)) {
      fs.mkdirSync(testPluginDir, { recursive: true })
    }

    // 创建App实例
    app = new App(testConfig)
  })

  afterEach(async () => {
    // 停止App
    await app.stop()

    // 清理测试插件目录
    if (fs.existsSync(testPluginDir)) {
      fs.rmSync(testPluginDir, { recursive: true, force: true })
    }
  })

  describe('构造函数测试', () => {
    it('应该使用默认配置创建App实例', () => {
      const defaultApp = new App()
      expect(defaultApp.getConfig()).toEqual(App.defaultConfig)
    })

    it('应该使用自定义配置创建App实例', () => {
      const config = app.getConfig()
      expect(config.plugin_dirs).toEqual(['./test-plugins'])
      expect(config.debug).toBe(true)
    })
  })

  describe('配置管理测试', () => {
    it('应该正确获取配置', () => {
      const config = app.getConfig()
      expect(config).toEqual(testConfig)
    })

    it('应该正确更新配置', () => {
      const newConfig: Partial<AppConfig> = {
        debug: false,
        plugin_dirs: ['./new-plugins']
      }
      app.updateConfig(newConfig)
      const config = app.getConfig()
      expect(config.debug).toBe(false)
      expect(config.plugin_dirs).toEqual(['./new-plugins'])
    })
  })

  describe('插件管理测试', () => {
    it('应该正确创建插件依赖', () => {
      const plugin = app.createDependency('test-plugin', 'test-plugin.ts')
      expect(plugin).toBeInstanceOf(Plugin)
      expect(plugin.name).toBe('test-plugin')
      expect(plugin.filename).toBe('test-plugin.ts')
    })

    it('应该正确加载插件', async () => {
      // 创建测试插件文件
      const pluginPath = path.join(testPluginDir, 'test-plugin.ts')
      fs.writeFileSync(pluginPath, `
        import { Plugin } from '@zhin.js/core'
        export default function(plugin: Plugin) {
          plugin.logger.info('插件已加载')
        }
      `)

      // 更新配置并加载插件
      app.updateConfig({
        plugins: [pluginPath]
      })

      // 启动App
      await app.start()

      // 验证插件是否被加载
      const plugin = app.findChild(pluginPath)
      expect(plugin).toBeDefined()
      expect(plugin?.isReady).toBe(true)
    })
  })

  describe('上下文管理测试', () => {
    it('应该正确获取上下文', async () => {
      // 创建测试适配器
      class TestAdapter extends Adapter {
        constructor() {
          super('test-adapter', () => ({} as any))
        }
        async start() {}
        async stop() {}
      }
      const adapter = new TestAdapter()

      // 注册适配器
      const plugin = app.createDependency('test-plugin', 'test-plugin.ts')
      const context = {
        name: adapter.name,
        mounted: () => adapter,
        dispose: () => {}
      }
      plugin.register(context)
      // 等待插件挂载
      await plugin.mounted()
      plugin.useContext('test-adapter',()=>{
        // 获取上下文
        const retrievedContext = app.getContext<TestAdapter>('test-adapter')
        expect(retrievedContext).toBe(adapter)
      })
    })

    it('当上下文不存在时应该抛出错误', () => {
      expect(() => app.getContext('non-existent')).toThrow("can't find Context of non-existent")
    })

    it('应该正确设置和获取上下文描述', async () => {
      // 创建测试插件
      const plugin = app.createDependency('test-plugin-desc', 'test-plugin-desc.ts')
      
      // 注册带描述的上下文  
      const context = {
        name: 'test-context',
        description: '这是一个测试上下文，用于验证描述字段功能',
        mounted: () => ({ testValue: 'test' }),
        dispose: () => {}
      }
      plugin.register(context)
      
      // 等待插件挂载
      await plugin.mounted()
      
      // 使用上下文来验证功能
      plugin.useContext('test-context', () => {
        // 验证上下文可以正常获取（先测试基本功能）
        const retrievedContext = app.getContext('test-context')
        expect(retrievedContext).toEqual({ testValue: 'test' })
        
        // 验证上下文列表包含描述信息
        const contextList = app.contextList
        const testContext = contextList.find(ctx => ctx.name === 'test-context')
        expect(testContext).toBeDefined()
        expect(testContext?.description).toBe('这是一个测试上下文，用于验证描述字段功能')
      })
    })
  })

  describe('消息处理测试', () => {
    it('应该正确处理发送消息前的钩子', async () => {
      const options = {
        id: '123',
        type: 'group' as const,
        context: 'test-adapter',
        bot: 'test-bot',
        content: '测试消息'
      }

      const plugin = app.createDependency('test-plugin', 'test-plugin.ts')
      const handler = vi.fn((opts) => ({
        ...opts,
        content: '修改后的消息'
      }))
      plugin.on('before-message.send', handler)

      // 触发发送消息事件
      plugin.emit('before-message.send', options)

      expect(handler).toHaveBeenCalledWith(options)
    })
  })

  describe('日志系统测试', () => {
    it('应该正确创建日志记录器', () => {
      const logger = app.getLogger('测试', '日志')
      expect(logger).toBeDefined()
    })
  })

  describe('生命周期测试', () => {
    it('应该正确启动和停止', async () => {
      const startSpy = vi.spyOn(app, 'start')
      const stopSpy = vi.spyOn(app, 'stop')

      await app.start()
      expect(startSpy).toHaveBeenCalled()
      expect(app.isReady).toBe(true)

      await app.stop()
      expect(stopSpy).toHaveBeenCalled()
      expect(app.isDispose).toBe(true)
    })
  })
})

describe('工厂函数测试', () => {
  it('应该正确创建App实例', async () => {
    const app = await createApp({
      debug: true,
      plugin_dirs: ['./test-plugins']
    })
    expect(app).toBeInstanceOf(App)
    expect(app.getConfig().debug).toBe(true)
    expect(app.getConfig().plugin_dirs).toEqual(['./test-plugins'])
    await app.stop()
  })

  it('应该使用默认配置创建App实例', async () => {
    const app = await createApp()
    expect(app).toBeInstanceOf(App)
    expect(app.getConfig()).toEqual(App.defaultConfig)
    await app.stop()
  })
})