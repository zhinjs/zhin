import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_APP_CONFIG } from '../src/setup/load-config.js'

function withTestDefaults(overrides: Record<string, unknown> = {}) {
  return { ...DEFAULT_APP_CONFIG, ...overrides }
}

describe('Setup - Default Configuration', () => {
  const testConfigPath = path.join(process.cwd(), 'test-zhin-config.yml')

  afterEach(() => {
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath)
    }
  })

  it('DEFAULT_APP_CONFIG 仅预设 Sandbox 适配器（Host/Console 由项目依赖插件提供）', () => {
    expect(DEFAULT_APP_CONFIG.plugins).toEqual(['@zhin.js/adapter-sandbox'])
  })

  it('should generate default config when file does not exist', async () => {
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')

    const configService = new ConfigService()
    await configService.load('test-zhin-config.yml', withTestDefaults())

    expect(fs.existsSync(testConfigPath)).toBe(true)

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    expect(config.log_level).toBe(LogLevel.INFO)
    expect(config.endpoints).toEqual([])
    expect(config.database).toEqual({
      dialect: 'sqlite',
      filename: './data/bot.db',
    })
    expect(config.plugin_dirs).toEqual(['node_modules', './src/plugins'])
    expect(config.plugins).toEqual(['@zhin.js/adapter-sandbox'])
    expect(config.services).toEqual([...DEFAULT_APP_CONFIG.services])
  })

  it('should have correct plugin_dirs order', async () => {
    const { ConfigService } = await import('@zhin.js/core')

    const configService = new ConfigService()
    await configService.load('test-zhin-config.yml', withTestDefaults())

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    expect(config.plugin_dirs[0]).toBe('node_modules')
    expect(config.plugin_dirs[1]).toBe('./src/plugins')
  })

  it('should merge minimal config with runtime defaults', async () => {
    const { ConfigService } = await import('@zhin.js/core')
    const { LogLevel } = await import('@zhin.js/logger')

    fs.writeFileSync(testConfigPath, [
      'database:',
      '  filename: ./data/custom.db',
      'plugins: []',
    ].join('\n'))

    const configService = new ConfigService()
    await configService.load('test-zhin-config.yml', withTestDefaults())

    const config = configService.get('test-zhin-config.yml') as Record<string, unknown>
    expect(config.log_level).toBe(LogLevel.INFO)
    expect(config.database).toEqual({ dialect: 'sqlite', filename: './data/custom.db' })
    expect(config.plugin_dirs).toEqual(['node_modules', './src/plugins'])
    expect(config.plugins).toEqual([])
    expect(config.services).toEqual([...DEFAULT_APP_CONFIG.services])
  })

  it('should preserve host plugin order when explicitly configured', async () => {
    const { ConfigService } = await import('@zhin.js/core')

    const plugins = [
      '@zhin.js/host-router',
      '@zhin.js/host-api',
      '@zhin.js/adapter-sandbox',
    ]
    const configService = new ConfigService()
    await configService.load('test-zhin-config.yml', withTestDefaults({ plugins }))

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    expect(config.plugins).toEqual(plugins)
    expect(config.plugins.indexOf('@zhin.js/host-router')).toBeLessThan(
      config.plugins.indexOf('@zhin.js/host-api'),
    )
  })

  it('should include all required services', async () => {
    const { ConfigService } = await import('@zhin.js/core')

    const configService = new ConfigService()
    await configService.load('test-zhin-config.yml', withTestDefaults())

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    expect(config.services).toEqual([...DEFAULT_APP_CONFIG.services])
  })

  it('should match minimal runtime config shape', async () => {
    const { ConfigService } = await import('@zhin.js/core')

    const configService = new ConfigService()
    await configService.load('test-zhin-config.yml', withTestDefaults())

    const content = fs.readFileSync(testConfigPath, 'utf-8')
    const config = parseYaml(content)

    expect(config).toHaveProperty('log_level')
    expect(config).toHaveProperty('endpoints')
    expect(config).toHaveProperty('database')
    expect(config).toHaveProperty('plugin_dirs')
    expect(config).toHaveProperty('plugins')
    expect(config).toHaveProperty('services')
    expect(config.plugin_dirs).toEqual(['node_modules', './src/plugins'])
  })
})
