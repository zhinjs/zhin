import { createRequire } from 'node:module'
import { describe, it, expect, beforeEach } from 'vitest'

const require = createRequire(import.meta.url)
let sqliteAvailable = false
try {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.close()
  sqliteAvailable = true
} catch {
  // Node 内置 SQLite 需要 Node.js 22.5+
}

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

    describe('processFieldValue (JSON parsing)', () => {
      let dialect: any

      beforeEach(async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        dialect = new SQLiteDialect({ filename: ':memory:' } as any)
      })

      // 通过 processRowData 间接测试 processFieldValue
      function processValue(value: any): any {
        // processRowData 会对每个字段调用 processFieldValue
        const result = (dialect as any).processRowData({ field: value })
        return result.field
      }

      it('should parse unquoted JSON object string', () => {
        const result = processValue('{"key":"value","num":42}')
        expect(result).toEqual({ key: 'value', num: 42 })
      })

      it('should parse unquoted JSON array string', () => {
        const result = processValue('[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]')
        expect(result).toEqual([
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ])
      })

      it('should parse single-quoted JSON string', () => {
        const result = processValue("'{\"x\":1}'")
        expect(result).toEqual({ x: 1 })
      })

      it('should parse double-quoted JSON string', () => {
        const result = processValue('"[1,2,3]"')
        expect(result).toEqual([1, 2, 3])
      })

      it('should leave plain text strings unchanged', () => {
        const result = processValue('hello world')
        expect(result).toBe('hello world')
      })

      it('should handle invalid JSON gracefully (unquoted)', () => {
        const result = processValue('{invalid json}')
        expect(result).toBe('{invalid json}')
      })

      it('should handle empty JSON object string', () => {
        const result = processValue('{}')
        expect(result).toEqual({})
      })

      it('should handle empty JSON array string', () => {
        const result = processValue('[]')
        expect(result).toEqual([])
      })

      it('should return non-string values as-is', () => {
        expect(processValue(42)).toBe(42)
        expect(processValue(null)).toBe(null)
        expect(processValue(undefined)).toBe(undefined)
        expect(processValue(true)).toBe(true)
      })
    })

    describe.skipIf(!sqliteAvailable)('bind params (JSON object)', () => {
      it('should INSERT plain object as JSON text and read back as object', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        await dialect.connect()
        await dialect.query('CREATE TABLE "github_events" ("id" INTEGER PRIMARY KEY, "payload" TEXT)')
        const payload = { repository: { full_name: 'o/r' }, zen: 'keep it simple' }
        await dialect.query(
          'INSERT INTO "github_events" ("id", "payload") VALUES (?, ?)',
          [1, payload],
        )
        const rows = (await dialect.query('SELECT "id", "payload" FROM "github_events"')) as any[]
        expect(rows[0].id).toBe(1)
        expect(rows[0].payload).toEqual(payload)
        await dialect.disconnect()
      })
    })
  })
})
