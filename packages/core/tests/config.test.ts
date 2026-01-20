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
})
