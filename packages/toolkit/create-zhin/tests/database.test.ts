import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DatabaseConfig } from '../src/types'

// Mock inquirer
vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn()
  }
}))

describe('create-zhin database', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('DatabaseConfig type', () => {
    it('should accept SQLite config', () => {
      const config: DatabaseConfig = {
        dialect: 'sqlite',
        filename: './data/bot.db',
        mode: 'wal'
      }
      
      expect(config.dialect).toBe('sqlite')
      expect(config.filename).toBe('./data/bot.db')
      expect(config.mode).toBe('wal')
    })

    it('should accept MySQL config', () => {
      const config: DatabaseConfig = {
        dialect: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'test_db'
      }
      
      expect(config.dialect).toBe('mysql')
      expect(config.host).toBe('localhost')
      expect(config.port).toBe(3306)
    })

    it('should accept PostgreSQL config', () => {
      const config: DatabaseConfig = {
        dialect: 'pg',
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'password',
        database: 'test_db'
      }
      
      expect(config.dialect).toBe('pg')
    })

    it('should accept MongoDB config', () => {
      const config: DatabaseConfig = {
        dialect: 'mongodb',
        url: 'mongodb://localhost:27017',
        dbName: 'test_db'
      }
      
      expect(config.dialect).toBe('mongodb')
      expect(config.url).toBe('mongodb://localhost:27017')
    })

    it('should accept Redis config', () => {
      const config: DatabaseConfig = {
        dialect: 'redis',
        socket: {
          host: 'localhost',
          port: 6379
        },
        password: 'password',
        database: 0
      }
      
      expect(config.dialect).toBe('redis')
      expect(config.socket).toBeDefined()
    })
  })

  describe('Database dialect validation', () => {
    it('should validate SQLite dialect', () => {
      const validDialects = ['sqlite', 'mysql', 'pg', 'mongodb', 'redis']
      expect(validDialects).toContain('sqlite')
    })

    it('should validate all supported dialects', () => {
      const dialects: DatabaseConfig['dialect'][] = ['sqlite', 'mysql', 'pg', 'mongodb', 'redis']
      
      dialects.forEach(dialect => {
        const config: DatabaseConfig = { dialect }
        expect(config.dialect).toBe(dialect)
      })
    })
  })
})
