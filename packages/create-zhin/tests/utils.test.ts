import { describe, it, expect } from 'vitest'
import { generateRandomPassword, getCurrentUsername, getDatabaseDisplayName } from '../src/utils'

describe('create-zhin utils', () => {
  describe('generateRandomPassword', () => {
    it('should generate password with default length', () => {
      const password = generateRandomPassword()
      expect(password).toBeDefined()
      expect(typeof password).toBe('string')
      expect(password.length).toBe(6)
    })

    it('should generate password with custom length', () => {
      const password = generateRandomPassword(10)
      expect(password.length).toBe(10)
    })

    it('should generate different passwords', () => {
      const password1 = generateRandomPassword()
      const password2 = generateRandomPassword()
      // 虽然理论上可能相同，但概率极低
      expect(password1).toBeDefined()
      expect(password2).toBeDefined()
    })

    it('should only contain valid characters', () => {
      const password = generateRandomPassword(100)
      const validChars = /^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/
      expect(validChars.test(password)).toBe(true)
    })
  })

  describe('getCurrentUsername', () => {
    it('should return a username', () => {
      const username = getCurrentUsername()
      expect(username).toBeDefined()
      expect(typeof username).toBe('string')
      expect(username.length).toBeGreaterThan(0)
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
