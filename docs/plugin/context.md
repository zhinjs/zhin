# 🔧 上下文系统

深入了解 Zhin.js 的上下文系统和依赖注入机制。

## 🎯 上下文系统概述

上下文系统是 Zhin.js 的核心特性，提供了强大的依赖注入功能，让插件可以声明式地使用各种服务。

## 🔧 注册上下文

### 基础注册
使用 `register` 函数注册上下文服务。

```typescript
import { register } from 'zhin.js'

register({
  name: 'database',
  description: '数据库服务，提供数据查询和存储功能',
  async mounted(plugin) {
    // 初始化数据库连接
    const db = await createDatabaseConnection()
    plugin.logger.info('数据库已连接')
    return db
  },
  async dispose(db) {
    // 清理数据库连接
    await db.close()
    plugin.logger.info('数据库连接已关闭')
  }
})
```

### 同步服务注册
对于不需要异步初始化的服务。

```typescript
register({
  name: 'cache',
  description: '内存缓存服务',
  mounted() {
    return new Map()
  },
  dispose(cache) {
    cache.clear()
  }
})
```

### 无清理的服务
对于不需要清理的服务。

```typescript
register({
  name: 'config',
  description: '配置服务',
  mounted() {
    return {
      apiKey: process.env.API_KEY,
      debug: process.env.DEBUG === 'true'
    }
  }
  // 不需要 dispose 函数
})
```

## 🎯 使用上下文

### 单个依赖
使用单个上下文依赖。

```typescript
import { useContext } from 'zhin.js'

useContext('database', (db) => {
  // 数据库就绪后执行
  addCommand(new MessageCommand('users')
    .action(async () => {
      const users = await db.query('SELECT * FROM users')
      return `用户数量: ${users.length}`
    })
  )
})
```

### 多个依赖
使用多个上下文依赖。

```typescript
useContext('database', 'cache', 'config', (db, cache, config) => {
  // 所有依赖都就绪后执行
  addCommand(new MessageCommand('stats')
    .action(async () => {
      const dbStats = await db.getStats()
      const cacheStats = cache.size
      const configInfo = config.debug ? '调试模式' : '生产模式'
      
      return `数据库: ${dbStats}, 缓存: ${cacheStats}, 模式: ${configInfo}`
    })
  )
})
```

### 条件依赖
根据条件使用不同的依赖。

```typescript
useContext('config', (config) => {
  if (config.debug) {
    useContext('debug-logger', (logger) => {
      addCommand(new MessageCommand('debug')
        .action(() => logger.getLogs())
      )
    })
  } else {
    useContext('production-logger', (logger) => {
      addCommand(new MessageCommand('logs')
        .action(() => logger.getRecentLogs())
      )
    })
  }
})
```

## 🔄 依赖等待机制

### 智能等待
框架会自动等待所有依赖就绪。

```typescript
// 即使 database 需要异步初始化，框架也会等待
useContext('database', 'cache', (db, cache) => {
  // 这里保证 database 和 cache 都已完全初始化
  console.log('所有依赖已就绪')
})
```

### 循环依赖检测
框架会自动检测和处理循环依赖。

```typescript
// 服务A依赖服务B
register({
  name: 'service-a',
  async mounted() {
    const serviceB = this.#use('service-b')
    return new ServiceA(serviceB)
  }
})

// 服务B依赖服务A
register({
  name: 'service-b', 
  async mounted() {
    const serviceA = this.#use('service-a')
    return new ServiceB(serviceA)
  }
})

// 框架会自动检测并处理这种循环依赖
```

## 🏗️ 服务设计模式

### 服务基类
创建可复用的服务基类。

```typescript
abstract class BaseService {
  protected logger: Logger
  
  constructor(protected plugin: Plugin) {
    this.logger = plugin.logger
  }
  
  abstract initialize(): Promise<void>
  abstract cleanup(): Promise<void>
}

class DatabaseService extends BaseService {
  private connection: any
  
  async initialize() {
    this.connection = await createConnection()
    this.logger.info('数据库服务已初始化')
  }
  
  async cleanup() {
    if (this.connection) {
      await this.connection.close()
      this.logger.info('数据库服务已清理')
    }
  }
  
  async query(sql: string, params?: any[]) {
    return this.connection.query(sql, params)
  }
}
```

### 服务注册
注册服务实例。

```typescript
register({
  name: 'database',
  description: '数据库服务',
  async mounted(plugin) {
    const service = new DatabaseService(plugin)
    await service.initialize()
    return service
  },
  async dispose(service) {
    await service.cleanup()
  }
})
```

## 🔧 高级用法

### 服务工厂
使用工厂模式创建服务。

```typescript
class ServiceFactory {
  static createDatabaseService(plugin: Plugin, config: DatabaseConfig) {
    return new DatabaseService(plugin, config)
  }
  
  static createCacheService(plugin: Plugin, config: CacheConfig) {
    return new CacheService(plugin, config)
  }
}

register({
  name: 'database',
  async mounted(plugin) {
    const config = plugin.getConfig('database')
    return ServiceFactory.createDatabaseService(plugin, config)
  }
})
```

### 服务组合
组合多个服务创建复合服务。

```typescript
class UserService {
  constructor(
    private db: DatabaseService,
    private cache: CacheService,
    private logger: Logger
  ) {}
  
  async getUser(id: string) {
    // 先检查缓存
    const cached = this.cache.get(`user:${id}`)
    if (cached) return cached
    
    // 从数据库获取
    const user = await this.db.query('SELECT * FROM users WHERE id = ?', [id])
    
    // 缓存结果
    this.cache.set(`user:${id}`, user, 300000) // 5分钟
    
    return user
  }
}

register({
  name: 'user-service',
  async mounted(plugin) {
    const db = plugin.getContext('database')
    const cache = plugin.getContext('cache')
    const logger = plugin.logger
    
    return new UserService(db, cache, logger)
  }
})
```

### 服务配置
为服务添加配置支持。

```typescript
interface DatabaseConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
}

register({
  name: 'database',
  async mounted(plugin) {
    const config: DatabaseConfig = {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'zhin'
    }
    
    const db = new DatabaseService(config)
    await db.connect()
    return db
  }
})
```

## 🧪 测试上下文

### 模拟上下文
在测试中模拟上下文服务。

```typescript
// tests/plugin.test.ts
import { describe, it, expect, beforeEach } from 'vitest'

describe('Plugin with Context', () => {
  let mockDatabase: any
  
  beforeEach(() => {
    mockDatabase = {
      query: vi.fn().mockResolvedValue([{ id: 1, name: 'test' }])
    }
    
    // 模拟上下文
    register({
      name: 'database',
      mounted() {
        return mockDatabase
      }
    })
  })
  
  it('should use database context', async () => {
    useContext('database', (db) => {
      expect(db).toBe(mockDatabase)
    })
  })
})
```

### 集成测试
测试上下文与插件的集成。

```typescript
describe('Context Integration', () => {
  it('should initialize all contexts', async () => {
    const app = await createApp({
      plugins: ['my-plugin']
    })
    
    await app.start()
    
    // 验证上下文是否正确初始化
    const db = app.getContext('database')
    expect(db).toBeDefined()
    expect(db.isConnected()).toBe(true)
  })
})
```

## 🔗 相关链接

- [插件开发指南](./development.md)
- [插件生命周期](./lifecycle.md)
- [中间件系统](./middleware.md)
- [定时任务](./cron.md)
