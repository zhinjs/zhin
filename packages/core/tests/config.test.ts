import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadConfig,
  saveConfig,
  createDefaultConfig,
  defineConfig,
  ConfigFormat,
  ConfigOptions
} from '../src/config'
import fs from 'node:fs'
import path from 'node:path'
import { AppConfig } from '../src/types'

describe('配置系统测试', () => {
  const testDir = path.join(process.cwd(), 'test-config')
  const originalEnv = process.env

  beforeEach(() => {
    // 创建测试目录
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir)
    }
    // 重置环境变量
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true })
    }
    // 恢复环境变量
    process.env = originalEnv
  })

  describe('配置文件加载测试', () => {
    it('应该正确加载JSON配置文件', async () => {
      const config: AppConfig = {
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      }
      const configPath = path.join(testDir, 'zhin.config.json')
      fs.writeFileSync(configPath, JSON.stringify(config))

      const [loadedPath, loadedConfig] = await loadConfig({ configPath })
      expect(loadedPath).toBe(configPath)
      expect(loadedConfig).toEqual(config)
    })

    it('应该正确加载YAML配置文件', async () => {
      const config = `
bots:
  - name: 测试机器人
    context: test
`
      const configPath = path.join(testDir, 'zhin.config.yaml')
      fs.writeFileSync(configPath, config)

      const [loadedPath, loadedConfig] = await loadConfig({ configPath })
      expect(loadedPath).toBe(configPath)
      expect(loadedConfig).toEqual({
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      })
    })

    it('应该正确加载环境变量', async () => {
      process.env.BOT_NAME = '环境变量机器人'
      const config = `
bots:
  - name: \${BOT_NAME}
    context: test
`
      const configPath = path.join(testDir, 'zhin.config.yaml')
      fs.writeFileSync(configPath, config)

      const [, loadedConfig] = await loadConfig({ configPath })
      expect(loadedConfig.bots[0].name).toBe('环境变量机器人')
    })

    it('应该使用环境变量默认值', async () => {
      const config = `
bots:
  - name: \${BOT_NAME:-默认机器人}
    context: test
`
      const configPath = path.join(testDir, 'zhin.config.yaml')
      fs.writeFileSync(configPath, config)

      const [, loadedConfig] = await loadConfig({ configPath })
      expect(loadedConfig.bots[0].name).toBe('默认机器人')
    })

    it('应该正确加载JavaScript配置文件', async () => {
      const config = `
module.exports = {
  bots: [
    { name: '测试机器人', context: 'test' }
  ]
}
`
      const configPath = path.join(testDir, 'zhin.config.ts')
      fs.writeFileSync(configPath, config)

      const [loadedPath, loadedConfig] = await loadConfig({ configPath })
      expect(loadedPath).toBe(configPath)
      expect(loadedConfig).toEqual({
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      })
    })

    it('应该正确加载TypeScript配置文件', async () => {
      // 创建配置文件
      const configPath = path.join(testDir, 'zhin.config.ts')
      fs.writeFileSync(configPath, `
export default {
  bots: [
    { name: '测试机器人', context: 'test' }
  ]
}
`)

      const [loadedPath, loadedConfig] = await loadConfig({ configPath })
      expect(loadedPath).toBe(configPath)
      expect(loadedConfig).toEqual({
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      })
    })
  })

  describe('配置文件保存测试', () => {
    it('应该正确保存JSON配置文件', () => {
      const config: AppConfig = {
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      }
      const filePath = path.join(testDir, 'config.json')
      saveConfig(config, filePath)

      const savedContent = fs.readFileSync(filePath, 'utf-8')
      expect(JSON.parse(savedContent)).toEqual(config)
    })

    it('应该正确保存YAML配置文件', () => {
      const config: AppConfig = {
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      }
      const filePath = path.join(testDir, 'config.yaml')
      saveConfig(config, filePath)

      const savedContent = fs.readFileSync(filePath, 'utf-8')
      expect(savedContent).toContain('name: 测试机器人')
      expect(savedContent).toContain('context: test')
    })

    it('应该拒绝保存不支持的格式', () => {
      const config: AppConfig = {
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      }
      const filePath = path.join(testDir, 'config.toml')
      expect(() => saveConfig(config, filePath)).toThrow('暂不支持保存 TOML 格式的配置文件')
    })
  })

  describe('配置验证测试', () => {
    it('应该验证必需的配置字段', async () => {
      const invalidConfig = {
        plugins: []
      }
      const configPath = path.join(testDir, 'zhin.config.json')
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig))

      await expect(loadConfig({ configPath })).rejects.toThrow('配置文件必须包含 bots 数组')
    })

    it('应该验证机器人配置', async () => {
      const invalidConfig = {
        bots: [
          { context: 'test' }
        ]
      }
      const configPath = path.join(testDir, 'zhin.config.json')
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig))

      await expect(loadConfig({ configPath })).rejects.toThrow('机器人 0 缺少 name 字段')
    })

    it('应该验证机器人上下文', async () => {
      const invalidConfig = {
        bots: [
          { name: '测试机器人' }
        ]
      }
      const configPath = path.join(testDir, 'zhin.config.json')
      fs.writeFileSync(configPath, JSON.stringify(invalidConfig))

      await expect(loadConfig({ configPath })).rejects.toThrow('机器人 测试机器人 缺少 context 字段')
    })
  })

  describe('默认配置测试', () => {
    it('应该创建默认配置', () => {
      const config = createDefaultConfig()
      expect(config.bots).toHaveLength(1)
      expect(config.bots[0].name).toBe('onebot11')
      expect(config.plugin_dirs).toEqual(['./src/plugins', 'node_modules'])
      expect(config.plugins).toEqual([])
    })

    it('应该支持环境变量替换', () => {
      process.env.ONEBOT_URL = 'ws://example.com'
      const config = createDefaultConfig()
      expect(config.bots[0].url).toBe('${ONEBOT_URL:-ws://localhost:8080}')
    })
  })

  describe('defineConfig辅助函数测试', () => {
    it('应该正确定义配置', () => {
      const config = defineConfig({
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      })
      expect(config).toEqual({
        bots: [
          { name: '测试机器人', context: 'test' }
        ]
      })
    })

    it('应该支持函数配置', () => {
      const config = defineConfig((env) => ({
        bots: [
          { name: env.BOT_NAME || '测试机器人', context: 'test' }
        ]
      }))
      expect(typeof config).toBe('function')
    })
  })

  describe('配置文件查找测试', () => {
    it('应该按优先级查找配置文件', async () => {
      // 创建多个配置文件
      fs.writeFileSync(
        path.join(testDir, 'config.json'),
        JSON.stringify({ bots: [{ name: 'json', context: 'test' }] })
      )
      fs.writeFileSync(
        path.join(testDir, 'zhin.config.yaml'),
        'bots:\n  - name: yaml\n    context: test'
      )

      const [configPath, loadedConfig] = await loadConfig({ configPath: path.join(testDir, 'zhin.config.yaml') })
      expect(configPath).toContain('zhin.config.yaml')
      expect(loadedConfig.bots[0].name).toBe('yaml')
    })

    it('当没有配置文件时应该抛出错误', async () => {
      await expect(loadConfig({ configPath: path.join(testDir, 'non-existent.json') }))
        .rejects.toThrow('配置文件不存在')
    })
  })

  describe('环境变量加载测试', () => {
    it('应该加载自定义环境文件', async () => {
      // 创建环境文件
      const envPath = path.join(testDir, '.env.test')
      fs.writeFileSync(envPath, 'BOT_NAME=测试环境机器人')
      
      const config = `
bots:
  - name: \${BOT_NAME}
    context: test
`
      const configPath = path.join(testDir, 'zhin.config.yaml')
      fs.writeFileSync(configPath, config)

      const options: ConfigOptions = {
        configPath,
        envPath
      }

      const [, loadedConfig] = await loadConfig(options)
      expect(loadedConfig.bots[0].name).toBe('测试环境机器人')
    })

    it('应该正确处理环境变量覆盖', async () => {
      process.env.BOT_NAME = '原始机器人'
      const envPath = path.join(testDir, '.env')
      fs.writeFileSync(envPath, 'BOT_NAME=新机器人')
      
      const config = `
bots:
  - name: \${BOT_NAME}
    context: test
`
      const configPath = path.join(testDir, 'zhin.config.yaml')
      fs.writeFileSync(configPath, config)

      // 不允许覆盖
      const [, loadedConfig1] = await loadConfig({
        configPath,
        envPath,
        envOverride: false
      })
      expect(loadedConfig1.bots[0].name).toBe('原始机器人')

      // 允许覆盖
      const [, loadedConfig2] = await loadConfig({
        configPath,
        envPath,
        envOverride: true
      })
      expect(loadedConfig2.bots[0].name).toBe('新机器人')
    })
  })
})