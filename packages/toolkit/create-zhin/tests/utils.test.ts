import { describe, it, expect } from 'vitest'
import { generateToken, getDatabaseDisplayName } from '../src/utils'

describe('create-zhin utils', () => {
  describe('generateToken', () => {
    it('should generate token with default bytes (32 hex chars)', () => {
      const token = generateToken()
      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.length).toBe(32)
    })

    it('should generate token with custom bytes', () => {
      const token = generateToken(8)
      expect(token.length).toBe(16)
    })

    it('should generate different tokens', () => {
      const token1 = generateToken()
      const token2 = generateToken()
      expect(token1).toBeDefined()
      expect(token2).toBeDefined()
    })

    it('should only contain hex characters', () => {
      const token = generateToken(32)
      const validChars = /^[0-9a-f]+$/
      expect(validChars.test(token)).toBe(true)
    })
  })

  describe('getDatabaseDisplayName', () => {
    it('should return SQLite for sqlite', () => {
      expect(getDatabaseDisplayName('sqlite')).toBe('SQLite')
    })

    it('should return MySQL for mysql', () => {
      expect(getDatabaseDisplayName('mysql')).toBe('MySQL')
    })

    it('should return PostgreSQL for pg', () => {
      expect(getDatabaseDisplayName('pg')).toBe('PostgreSQL')
    })

    it('should return MongoDB for mongodb', () => {
      expect(getDatabaseDisplayName('mongodb')).toBe('MongoDB')
    })

    it('should return Redis for redis', () => {
      expect(getDatabaseDisplayName('redis')).toBe('Redis')
    })

    it('should return original name for unknown dialect', () => {
      expect(getDatabaseDisplayName('unknown')).toBe('unknown')
    })
  })
})
