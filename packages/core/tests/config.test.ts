import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ConfigLoader } from '../src/built/config'
import fs from 'fs'
import path from 'path'

describe('ConfigLoader', () => {
  const testConfigPath = path.join(process.cwd(), 'test-config.json')
  
  afterEach(() => {
    // 清理测试文件
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath)
    }
  })

  describe('Proxy behavior', () => {
    it('should handle array methods correctly', () => {
      const config = {
        items: ['item1', 'item2', 'item3'],
        bots: [
          { context: 'sandbox', name: 'bot1' },
          { context: 'sandbox', name: 'bot2' }
        ]
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      // 测试数组的 map 方法
      expect(() => {
        const mapped = proxiedData.items.map((item: string) => item.toUpperCase())
        expect(mapped).toEqual(['ITEM1', 'ITEM2', 'ITEM3'])
      }).not.toThrow()
      
      // 测试数组的 filter 方法
      expect(() => {
        const filtered = proxiedData.bots.filter((bot: any) => bot.name === 'bot1')
        expect(filtered).toHaveLength(1)
      }).not.toThrow()
    })

    it('should handle nested objects', () => {
      const config = {
        database: {
          dialect: 'sqlite',
          filename: './data/bot.db'
        },
        http: {
          port: 8086,
          username: '${username}',
          password: '${password}'
        }
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      expect(proxiedData.database.dialect).toBe('sqlite')
      expect(proxiedData.http.port).toBe(8086)
    })

    it('should resolve environment variables', () => {
      process.env.TEST_VAR = 'test_value'
      
      const config = {
        testValue: '${TEST_VAR}'
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      expect(proxiedData.testValue).toBe('test_value')
      
      delete process.env.TEST_VAR
    })

    it('should handle escaped environment variables', () => {
      const config = {
        escapedValue: '\\${NOT_A_VAR}'
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      expect(proxiedData.escapedValue).toBe('${NOT_A_VAR}')
    })

    it('should handle default values for missing env vars', () => {
      const config = {
        valueWithDefault: '${MISSING_VAR:default_value}'
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      expect(proxiedData.valueWithDefault).toBe('default_value')
    })

    it('should not proxy function properties', () => {
      const config = {
        items: [1, 2, 3]
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      // 确保数组方法可以正常调用
      expect(typeof proxiedData.items.map).toBe('function')
      expect(typeof proxiedData.items.filter).toBe('function')
      expect(typeof proxiedData.items.reduce).toBe('function')
    })

    it('should handle Set operations from array', () => {
      const config = {
        bots: [
          { context: 'sandbox', name: 'bot1' },
          { context: 'process', name: 'bot2' },
          { context: 'sandbox', name: 'bot3' }
        ]
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      const proxiedData = loader.data
      
      // 模拟 setup.ts 中的操作
      expect(() => {
        const contexts = new Set(proxiedData.bots.map((bot: any) => bot.context))
        expect(contexts.size).toBe(2)
        expect(contexts.has('sandbox')).toBe(true)
        expect(contexts.has('process')).toBe(true)
      }).not.toThrow()
    })
  })

  describe('Raw data access', () => {
    it('should provide raw data without proxy', () => {
      const config = {
        value: '${TEST_VAR}'
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      
      // raw 应该返回原始值，不解析环境变量
      expect(loader.raw.value).toBe('${TEST_VAR}')
      
      // data 应该尝试解析环境变量
      expect(loader.data.value).toBeTruthy()
    })
  })

  describe('File operations', () => {
    it('should save and load JSON config', () => {
      const jsonPath = path.join(process.cwd(), 'test-config.json')
      const config = {
        name: 'test',
        value: 123
      }
      
      const loader = new ConfigLoader(jsonPath, config)
      loader.save(jsonPath)
      
      expect(fs.existsSync(jsonPath)).toBe(true)
      
      const content = fs.readFileSync(jsonPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.name).toBe('test')
      expect(parsed.value).toBe(123)
      
      fs.unlinkSync(jsonPath)
    })

    it('should save and load YAML config', () => {
      const yamlPath = path.join(process.cwd(), 'test-config.yml')
      const config = {
        name: 'test',
        value: 123
      }
      
      const loader = new ConfigLoader(yamlPath, config)
      loader.save(yamlPath)
      
      expect(fs.existsSync(yamlPath)).toBe(true)
      
      fs.unlinkSync(yamlPath)
    })

    it('should auto-save on property change', () => {
      const config = {
        value: 'initial'
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      loader.save(testConfigPath)
      
      // 修改属性应该触发自动保存
      const proxiedData = loader.data
      proxiedData.value = 'changed'
      
      // 重新读取文件验证保存
      const content = fs.readFileSync(testConfigPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.value).toBe('changed')
    })

    it('should auto-save on property deletion', () => {
      const config = {
        value: 'test',
        other: 'keep'
      }
      
      const loader = new ConfigLoader(testConfigPath, config)
      loader.save(testConfigPath)
      
      // 删除属性应该触发自动保存
      const proxiedData = loader.data as any
      delete proxiedData.value
      
      // 重新读取文件验证保存
      const content = fs.readFileSync(testConfigPath, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.value).toBeUndefined()
      expect(parsed.other).toBe('keep')
    })
  })

  describe('ConfigService', () => {
    it('should load and cache configs', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      const config = { test: 'value' }
      service.load('test-config.json', config)
      
      expect(service.configs.has('test-config.json')).toBe(true)
    })

    it('should throw error for unsupported format', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      expect(() => {
        service.load('test.txt', {})
      }).toThrow('不支持的配置文件格式')
    })

    it('should get config data', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      const config = { test: 'value' }
      service.load(testConfigPath, config)
      
      const data = service.get(testConfigPath)
      expect(data.test).toBe('value')
    })

    it('should get raw config data', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      const config = { test: '${VAR}' }
      service.load(testConfigPath, config)
      
      const raw = service.getRaw(testConfigPath)
      expect(raw.test).toBe('${VAR}')
    })

    it('should update config data', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      const config = { test: 'initial' }
      service.load(testConfigPath, config)
      
      service.set(testConfigPath, { test: 'updated' })
      
      const data = service.get(testConfigPath)
      expect(data.test).toBe('updated')
    })

    it('should throw error when getting non-existent config', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      service.load(testConfigPath, { test: 'value' })
      service.configs.delete(testConfigPath) // 手动删除以模拟不存在的情况
      
      // 由于 get 会自动加载，我们需要测试 set
      expect(() => {
        service.set('non-existent.json', {})
      }).toThrow('配置文件 non-existent.json 未加载')
    })

    it('should auto-load config if not cached', async () => {
      const { ConfigService } = await import('../src/built/config')
      const service = new ConfigService()
      
      const config = { test: 'value' }
      // 先保存文件
      const loader = new ConfigLoader(testConfigPath, config)
      loader.save(testConfigPath)
      
      // 不预先加载，直接 get
      const data = service.get(testConfigPath, config)
      expect(data.test).toBe('value')
      expect(service.configs.has(testConfigPath)).toBe(true)
    })
  })

  describe('Extension detection', () => {
    it('should detect .json extension', () => {
      const loader = new ConfigLoader('config.json', {})
      expect(loader.extension).toBe('.json')
    })

    it('should detect .yml extension', () => {
      const loader = new ConfigLoader('config.yml', {})
      expect(loader.extension).toBe('.yml')
    })

    it('should detect .yaml extension', () => {
      const loader = new ConfigLoader('config.yaml', {})
      expect(loader.extension).toBe('.yaml')
    })
  })
})
