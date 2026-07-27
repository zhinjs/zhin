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

    describe('processFieldValue (按列声明类型反序列化)', () => {
      let dialect: any

      beforeEach(async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        // 注册表结构：field 声明为 json 列，plain 声明为 text 列
        dialect.registerTableSchema('t', {
          field: { type: 'json' },
          plain: { type: 'text' },
        })
      })

      // 通过 processRowData 间接测试 processFieldValue
      function processValue(value: any, key = 'field'): any {
        const result = (dialect as any).processRowData({ [key]: value })
        return result[key]
      }

      it('should parse unquoted JSON object string on json column', () => {
        const result = processValue('{"key":"value","num":42}')
        expect(result).toEqual({ key: 'value', num: 42 })
      })

      it('should parse unquoted JSON array string on json column', () => {
        const result = processValue('[{"role":"user","content":"hi"},{"role":"assistant","content":"hello"}]')
        expect(result).toEqual([
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
        ])
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

      it('should NOT parse JSON-looking text on text column (round-trip)', () => {
        expect(processValue('{"key":"value"}', 'plain')).toBe('{"key":"value"}')
        expect(processValue('[1,2,3]', 'plain')).toBe('[1,2,3]')
      })

      it('should NOT strip quotes from text column values (round-trip)', () => {
        expect(processValue('"hello"', 'plain')).toBe('"hello"')
        expect(processValue("'hello'", 'plain')).toBe("'hello'")
      })

      it('should NOT parse JSON-looking text when no schema registered', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const bare = new SQLiteDialect({ filename: ':memory:' } as any)
        const result = (bare as any).processRowData({ field: '{"a":1}' })
        expect(result.field).toBe('{"a":1}')
      })
    })

    describe.skipIf(!sqliteAvailable)('bind params (JSON object)', () => {
      it('should INSERT plain object as JSON text and read back as object', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        dialect.registerTableSchema('github_events', { payload: { type: 'json' } })
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

    describe.skipIf(!sqliteAvailable)('query() statement dispatch', () => {
      it('WITH...SELECT should return rows', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        await dialect.connect()
        const rows = (await dialect.query('WITH x AS (SELECT 1 AS v) SELECT * FROM x')) as any[]
        expect(rows).toHaveLength(1)
        expect(rows[0].v).toBe(1)
        await dialect.disconnect()
      })

      it('PRAGMA should return rows', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        await dialect.connect()
        await dialect.query('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY, "name" TEXT)')
        const rows = (await dialect.query('PRAGMA table_info(t)')) as any[]
        expect(rows.length).toBe(2)
        await dialect.disconnect()
      })

      it('INSERT...RETURNING should return rows', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        await dialect.connect()
        await dialect.query('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY, "name" TEXT)')
        const rows = (await dialect.query('INSERT INTO "t" ("name") VALUES (?) RETURNING "id", "name"', ['a'])) as any[]
        expect(rows).toHaveLength(1)
        expect(rows[0].name).toBe('a')
        await dialect.disconnect()
      })

      it('plain INSERT should still return lastID/changes', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        await dialect.connect()
        await dialect.query('CREATE TABLE "t" ("id" INTEGER PRIMARY KEY, "name" TEXT)')
        const result = (await dialect.query('INSERT INTO "t" ("name") VALUES (?)', ['a'])) as any
        expect(result.lastID).toBe(1)
        expect(result.changes).toBe(1)
        await dialect.disconnect()
      })

      it('DDL should not throw', async () => {
        const { SQLiteDialect } = await import('../src/dialects/sqlite')
        const dialect = new SQLiteDialect({ filename: ':memory:' } as any)
        await dialect.connect()
        await expect(dialect.query('CREATE TABLE "t" ("id" INTEGER)')).resolves.toBeDefined()
        await dialect.disconnect()
      })
    })
  })
})
