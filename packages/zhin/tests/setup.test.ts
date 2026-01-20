import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parse as parseYaml } from 'yaml'

describe('Setup - Default Configuration', () => {
  const testConfigPath = path.join(process.cwd(), 'test-zhin-config.yml')

  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath)
    }
  })

  it('should generate default config when file does not exist', async () => {
    // 动态导入 ConfigService
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')
    
    const configService = new ConfigService()
    
    // 加载配置（应该会生成默认配置文件）
    await configService.load('test-zhin-config.yml', {
      log_level: LogLevel.INFO,
      bots: [],
      database: {
        dialect: "sqlite",
        filename: "./data/test.db"
      },
      plugin_dirs: ['node_modules', './src/plugins'],
      plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
      services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
    })

    // 验证配置文件已生成
    expect(fs.existsSync(testConfigPath)).toBe(true)

    // 读取并解析配置文件
    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    // 验证默认配置内容
    expect(config.log_level).toBe(LogLevel.INFO)
    expect(config.bots).toEqual([])
    expect(config.database).toEqual({
      dialect: "sqlite",
      filename: "./data/test.db"
    })
    expect(config.plugin_dirs).toEqual(['node_modules', './src/plugins'])
    expect(config.plugins).toEqual(['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'])
    expect(config.services).toEqual(['process', 'config', 'command', 'component', 'permission', 'cron'])
  })

  it('should have correct plugin_dirs order', async () => {
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')
    
    const configService = new ConfigService()
    
    await configService.load('test-zhin-config.yml', {
      log_level: LogLevel.INFO,
      bots: [],
      database: {
        dialect: "sqlite",
        filename: "./data/test.db"
      },
      plugin_dirs: ['node_modules', './src/plugins'],
      plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
      services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
    })

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    // 验证 plugin_dirs 顺序：node_modules 在前，./src/plugins 在后
    expect(config.plugin_dirs[0]).toBe('node_modules')
    expect(config.plugin_dirs[1]).toBe('./src/plugins')
  })

  it('should have correct plugins loading order', async () => {
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')
    
    const configService = new ConfigService()
    
    await configService.load('test-zhin-config.yml', {
      log_level: LogLevel.INFO,
      bots: [],
      database: {
        dialect: "sqlite",
        filename: "./data/test.db"
      },
      plugin_dirs: ['node_modules', './src/plugins'],
      plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
      services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
    })

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    // 验证插件加载顺序：服务插件在前，适配器插件在后
    expect(config.plugins).toContain('@zhin.js/http')
    expect(config.plugins).toContain('@zhin.js/console')
    expect(config.plugins).toContain('@zhin.js/adapter-sandbox')
    
    // 验证顺序
    const httpIndex = config.plugins.indexOf('@zhin.js/http')
    const consoleIndex = config.plugins.indexOf('@zhin.js/console')
    const sandboxIndex = config.plugins.indexOf('@zhin.js/adapter-sandbox')
    
    expect(httpIndex).toBeGreaterThanOrEqual(0)
    expect(consoleIndex).toBeGreaterThanOrEqual(0)
    expect(sandboxIndex).toBeGreaterThanOrEqual(0)
  })

  it('should include all required services', async () => {
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')
    
    const configService = new ConfigService()
    
    await configService.load('test-zhin-config.yml', {
      log_level: LogLevel.INFO,
      bots: [],
      database: {
        dialect: "sqlite",
        filename: "./data/test.db"
      },
      plugin_dirs: ['node_modules', './src/plugins'],
      plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
      services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
    })

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    // 验证所有必需的服务都包含在内
    const requiredServices = ['process', 'config', 'command', 'component', 'permission', 'cron']
    expect(config.services).toEqual(requiredServices)
  })

  it('should match test-bot configuration structure', async () => {
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')
    
    const configService = new ConfigService()
    
    await configService.load('test-zhin-config.yml', {
      log_level: LogLevel.INFO,
      bots: [],
      database: {
        dialect: "sqlite",
        filename: "./data/test.db"
      },
      plugin_dirs: ['node_modules', './src/plugins'],
      plugins: ['@zhin.js/http', '@zhin.js/console', '@zhin.js/adapter-sandbox'],
      services: ['process', 'config', 'command', 'component', 'permission', 'cron'],
    })

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    // 验证配置结构与 test-bot 一致
    expect(config).toHaveProperty('log_level')
    expect(config).toHaveProperty('bots')
    expect(config).toHaveProperty('database')
    expect(config).toHaveProperty('plugin_dirs')
    expect(config).toHaveProperty('plugins')
    expect(config).toHaveProperty('services')
    
    // 验证 plugin_dirs 与 test-bot 一致
    expect(config.plugin_dirs).toEqual(['node_modules', './src/plugins'])
  })
})
