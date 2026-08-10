import { describe, it, expect } from 'vitest'

describe('CLI Utils', () => {
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
