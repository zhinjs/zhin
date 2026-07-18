import { describe, it, expect } from 'vitest'
import fs from 'fs-extra'
import os from 'node:os'
import path from 'node:path'
import { createConfigFile, generateDatabaseEnvVars } from '../src/config'
import { RECOMMENDED_AI_DEFAULTS, materializeDatabaseConfig, type DatabaseConfig, type InitOptions } from '@zhin.js/scaffold-wizard';

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

  describe('materializeDatabaseConfig', () => {
    it('keeps sqlite fields as-is', () => {
      expect(materializeDatabaseConfig({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' }))
        .toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' })
    })

    it('references env vars for mysql', () => {
      const config = materializeDatabaseConfig({ dialect: 'mysql', host: 'localhost', port: 3306 })
      expect(config.dialect).toBe('mysql')
      expect(config.host).toBe('${DB_HOST}')
      expect(config.port).toBe('${DB_PORT}')
    })
  })

  describe('createConfigFile', () => {
    it('generates new runtime JSON config with plugins.<instanceKey> map', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-config-'))
      try {
        const options: InitOptions = {
          config: 'json',
          runtime: 'node',
          httpToken: 'token',
          database: {
            dialect: 'sqlite',
            filename: './data/bot.db',
            mode: 'wal'
          },
          adapters: {
            packages: ['@zhin.js/adapter-sandbox'],
            plugins: ['@zhin.js/adapter-sandbox'],
            instances: [{
              package: '@zhin.js/adapter-sandbox',
              instanceKey: 'sandbox',
              config: { endpoints: [{ context: 'sandbox', name: 'sandbox-bot', owner: 'sandbox-user' }] }
            }],
            envVars: {}
          },
          ai: { enabled: false }
        }

        await createConfigFile(root, 'json', options)
        const raw = await fs.readFile(path.join(root, 'zhin.config.json'), 'utf8')
        const parsed = JSON.parse(raw)

        expect(parsed.http.base).toBe('/api')
        expect(parsed.http.corsOrigins).toEqual(['https://console.zhin.dev'])
        expect(parsed.plugins.sandbox.endpoints).toHaveLength(1)
        // legacy 顶层键不得出现（runtime config-composer additionalProperties: false）
        expect(parsed.inbox).toBeUndefined()
        expect(parsed.endpoints).toBeUndefined()
        expect(Array.isArray(parsed.plugins)).toBe(false)
      } finally {
        await fs.remove(root)
      }
    })

    it('generates AI defaults in YAML config', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-config-'))
      try {
        const options: InitOptions = {
          config: 'yaml',
          runtime: 'node',
          httpToken: 'token',
          database: {
            dialect: 'sqlite',
            filename: './data/bot.db',
            mode: 'wal'
          },
          ai: {
            enabled: true,
            agentProvider: 'ollama',
            providers: {
              ollama: {
                host: 'http://localhost:11434',
                models: ['qwen3:8b']
              }
            },
            sessions: RECOMMENDED_AI_DEFAULTS.sessions,
            context: RECOMMENDED_AI_DEFAULTS.context,
            agent: RECOMMENDED_AI_DEFAULTS.agent,
            trigger: {
              respondToAt: true,
              respondToPrivate: true,
              prefixes: ['#'],
              ignorePrefixes: RECOMMENDED_AI_DEFAULTS.trigger.ignorePrefixes,
              timeout: RECOMMENDED_AI_DEFAULTS.trigger.timeout
            },
            memoryMcp: false,
            mcpServers: []
          }
        }

        await createConfigFile(root, 'yaml', options)
        const raw = await fs.readFile(path.join(root, 'zhin.config.yml'), 'utf8')

        expect(raw).toContain('sessions:')
        expect(raw).toContain('context:')
        expect(raw).toContain('agent:')
        expect(raw).toContain('sdk: ollama')
        expect(raw).toContain('provider: ollama')
        expect(raw).toContain('memoryMcp: false')
        expect(raw).not.toContain('defaultProvider')
      } finally {
        await fs.remove(root)
      }
    })
  })
})
