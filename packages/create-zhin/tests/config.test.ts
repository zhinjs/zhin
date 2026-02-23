import { describe, it, expect } from 'vitest'
import { generateDatabaseConfig, generateDatabaseEnvVars } from '../src/config'
import type { DatabaseConfig } from '../src/types'

describe('create-zhin config', () => {
  describe('generateDatabaseEnvVars', () => {
    it('should generate MySQL env vars', () => {
      const config: DatabaseConfig = {
        dialect: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'test_db'
      }
      
      const envVars = generateDatabaseEnvVars(config)
      
      expect(envVars).toContain('# MySQL 数据库配置')
      expect(envVars).toContain('DB_HOST=localhost')
      expect(envVars).toContain('DB_PORT=3306')
      expect(envVars).toContain('DB_USER=root')
      expect(envVars).toContain('DB_PASSWORD=password')
      expect(envVars).toContain('DB_DATABASE=test_db')
    })

    it('should generate PostgreSQL env vars', () => {
      const config: DatabaseConfig = {
        dialect: 'pg',
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'password',
        database: 'test_db'
      }
      
      const envVars = generateDatabaseEnvVars(config)
      
      expect(envVars).toContain('# PostgreSQL 数据库配置')
      expect(envVars).toContain('DB_HOST=localhost')
      expect(envVars).toContain('DB_PORT=5432')
    })

    it('should generate MongoDB env vars', () => {
      const config: DatabaseConfig = {
        dialect: 'mongodb',
        url: 'mongodb://localhost:27017',
        dbName: 'test_db'
      }
      
      const envVars = generateDatabaseEnvVars(config)
      
      expect(envVars).toContain('# MongoDB 数据库配置')
      expect(envVars).toContain('DB_URL=mongodb://localhost:27017')
      expect(envVars).toContain('DB_NAME=test_db')
    })

    it('should generate Redis env vars', () => {
      const config: DatabaseConfig = {
        dialect: 'redis',
        socket: {
          host: 'localhost',
          port: 6379
        },
        password: 'password',
        database: 0
      }
      
      const envVars = generateDatabaseEnvVars(config)
      
      expect(envVars).toContain('# Redis 数据库配置')
      expect(envVars).toContain('REDIS_HOST=localhost')
      expect(envVars).toContain('REDIS_PORT=6379')
      expect(envVars).toContain('REDIS_PASSWORD=password')
      expect(envVars).toContain('REDIS_DB=0')
    })

    it('should return empty string for SQLite', () => {
      const config: DatabaseConfig = {
        dialect: 'sqlite',
        filename: './data/bot.db'
      }
      
      const envVars = generateDatabaseEnvVars(config)
      
      expect(envVars).toBe('')
    })
  })

  describe('generateDatabaseConfig', () => {
    it('should generate YAML config for SQLite with mode', () => {
      const config: DatabaseConfig = {
        dialect: 'sqlite',
        filename: './data/bot.db',
        mode: 'wal'
      }
      
      const yamlConfig = generateDatabaseConfig(config, 'yaml')
      
      expect(yamlConfig).toContain('dialect: sqlite')
      expect(yamlConfig).toContain('filename: ./data/bot.db')
      expect(yamlConfig).toContain('mode: wal')
    })

    it('should generate YAML config for MySQL', () => {
      const config: DatabaseConfig = {
        dialect: 'mysql',
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'password',
        database: 'test_db'
      }
      
      const yamlConfig = generateDatabaseConfig(config, 'yaml')
      
      expect(yamlConfig).toContain('dialect: mysql')
      expect(yamlConfig).toContain('${DB_HOST}')
      expect(yamlConfig).toContain('${DB_PORT}')
    })

    it('should generate YAML config for SQLite', () => {
      const config: DatabaseConfig = {
        dialect: 'sqlite',
        filename: './data/bot.db'
      }
      
      const yamlConfig = generateDatabaseConfig(config, 'yaml')
      
      expect(yamlConfig).toContain('dialect: sqlite')
      expect(yamlConfig).toContain('filename: ./data/bot.db')
    })

    it('should generate JSON config for SQLite', () => {
      const config: DatabaseConfig = {
        dialect: 'sqlite',
        filename: './data/bot.db'
      }
      
      const jsonConfig = generateDatabaseConfig(config, 'json')
      
      expect(jsonConfig).toContain('"database":')
      expect(jsonConfig).toContain('"dialect": "sqlite"')
    })

    it('should generate TOML config for SQLite', () => {
      const config: DatabaseConfig = {
        dialect: 'sqlite',
        filename: './data/bot.db'
      }
      
      const tomlConfig = generateDatabaseConfig(config, 'toml')
      
      expect(tomlConfig).toContain('[database]')
      expect(tomlConfig).toContain('dialect = "sqlite"')
    })
  })
})
