import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs-extra'
import * as path from 'path'
import { tmpdir } from 'os'

describe('CLI Utils', () => {
  describe('env utilities', () => {
    let testDir: string

    beforeEach(async () => {
      testDir = path.join(tmpdir(), `zhin-test-${Date.now()}`)
      await fs.ensureDir(testDir)
    })

    afterEach(async () => {
      await fs.remove(testDir)
    })

    it('should export loadEnvFiles function', async () => {
      const { loadEnvFiles } = await import('../src/utils/env')
      expect(typeof loadEnvFiles).toBe('function')
    })

    it('should export getEnvLoadOrder function', async () => {
      const { getEnvLoadOrder } = await import('../src/utils/env')
      expect(typeof getEnvLoadOrder).toBe('function')
    })

    it('getEnvLoadOrder should return correct order', async () => {
      const { getEnvLoadOrder } = await import('../src/utils/env')
      const order = getEnvLoadOrder('development')
      expect(order).toBeInstanceOf(Array)
      expect(order.length).toBe(2)
      expect(order[0]).toContain('.env')
      expect(order[1]).toContain('development')
    })

    it('loadEnvFiles should not throw when no env files exist', async () => {
      const { loadEnvFiles } = await import('../src/utils/env')
      expect(() => loadEnvFiles(testDir, 'test')).not.toThrow()
    })

    it('loadEnvFiles should load env file if exists', async () => {
      const { loadEnvFiles } = await import('../src/utils/env')
      const envPath = path.join(testDir, '.env')
      await fs.writeFile(envPath, 'TEST_VAR=test_value')
      
      loadEnvFiles(testDir, 'test')
      expect(process.env.TEST_VAR).toBe('test_value')
      
      // 清理
      delete process.env.TEST_VAR
    })
  })

  describe('logger utilities', () => {
    it('should export logger', async () => {
      const { logger } = await import('../src/utils/logger')
      expect(logger).toBeDefined()
      expect(typeof logger).toBe('object')
    })

    it('logger should have log methods', async () => {
      const { logger } = await import('../src/utils/logger')
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
    })
  })

  describe('process utilities', () => {
    it('should export process utilities', async () => {
      const processUtils = await import('../src/utils/process')
      expect(processUtils).toBeDefined()
    })
  })
})
