import { describe, it, expect } from 'vitest'

describe('Database Dialects', () => {
  describe('Memory Dialect', () => {
    it('should export MemoryDialect', async () => {
      const { MemoryDialect } = await import('../src/dialects/memory')
      expect(MemoryDialect).toBeDefined()
      expect(typeof MemoryDialect).toBe('function')
    })
  })

  describe('MySQL Dialect', () => {
    it('should export MySQLDialect', async () => {
      const { MySQLDialect } = await import('../src/dialects/mysql')
      expect(MySQLDialect).toBeDefined()
      expect(typeof MySQLDialect).toBe('function')
    })
  })

  describe('PostgreSQL Dialect', () => {
    it('should export PostgreSQLDialect', async () => {
      const { PostgreSQLDialect } = await import('../src/dialects/pg')
      expect(PostgreSQLDialect).toBeDefined()
      expect(typeof PostgreSQLDialect).toBe('function')
    })
  })

  describe('MongoDB Dialect', () => {
    it('should export MongoDBDialect', async () => {
      const { MongoDBDialect } = await import('../src/dialects/mongodb')
      expect(MongoDBDialect).toBeDefined()
      expect(typeof MongoDBDialect).toBe('function')
    })
  })

  describe('Redis Dialect', () => {
    it('should export RedisDialect', async () => {
      const { RedisDialect } = await import('../src/dialects/redis')
      expect(RedisDialect).toBeDefined()
      expect(typeof RedisDialect).toBe('function')
    })
  })

  describe('SQLite Dialect', () => {
    it('should export SQLiteDialect', async () => {
      const { SQLiteDialect } = await import('../src/dialects/sqlite')
      expect(SQLiteDialect).toBeDefined()
      expect(typeof SQLiteDialect).toBe('function')
    })
  })
})
