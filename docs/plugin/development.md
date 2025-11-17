# 🧩 插件开发指南

深入学习 Zhin.js 插件开发的高级技巧和最佳实践。

## 🎯 插件开发流程

### 1. 创建插件文件
在 `src/plugins/` 目录下创建插件文件。

```typescript
// src/plugins/my-awesome-plugin.ts
import { useLogger, onMessage, addCommand, MessageCommand } from 'zhin.js'

const logger = useLogger()

// 插件逻辑
onMessage(async (message) => {
  if (message.raw === 'hello') {
    await message.reply('Hello from my awesome plugin!')
  }
})

addCommand(new MessageCommand('awesome')
  .action(async () => {
    return 'This is awesome!'
  })
)

logger.info('My awesome plugin loaded!')
```

### 2. 启用插件
在 `zhin.config.ts` 中启用插件。

```typescript
export default defineConfig(async (env) => {
  return {
    plugins: [
      'adapter-process',
      'http',
      'console',
      'my-awesome-plugin'  // 添加你的插件
    ]
  }
})
```

### 3. 测试插件
启动开发服务器测试插件。

```bash
pnpm dev
```

## 🏗️ 插件架构设计

### 模块化设计
将插件拆分为多个模块。

```typescript
// src/plugins/weather/
// ├── index.ts          # 主入口
// ├── weather-service.ts # 天气服务
// ├── weather-commands.ts # 天气命令
// └── weather-types.ts   # 类型定义

// index.ts
export { WeatherService } from './weather-service'
export { WeatherCommands } from './weather-commands'
export * from './weather-types'

// 注册插件
import { WeatherCommands } from './weather-commands'
new WeatherCommands().register()
```

### 服务层设计
将业务逻辑封装为服务。

```typescript
// weather-service.ts
export class WeatherService {
  private cache = new Map<string, WeatherData>()
  
  async getWeather(city: string): Promise<WeatherData> {
    const cacheKey = `weather:${city}`
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!
    }
    
    const weather = await this.fetchWeatherFromAPI(city)
    this.cache.set(cacheKey, weather)
    
    return weather
  }
  
  private async fetchWeatherFromAPI(city: string): Promise<WeatherData> {
    // API 调用逻辑
  }
}
```

## 🔧 高级功能

### 配置管理
为插件添加配置支持。

```typescript
// weather-config.ts
export interface WeatherConfig {
  apiKey: string
  defaultCity: string
  cacheTimeout: number
  units: 'metric' | 'imperial'
}

export const defaultConfig: WeatherConfig = {
  apiKey: process.env.WEATHER_API_KEY || '',
  defaultCity: 'Beijing',
  cacheTimeout: 300000, // 5分钟
  units: 'metric'
}
```

### 配置验证
使用 Zod 验证配置。

```typescript
import { z } from 'zod'

const WeatherConfigSchema = z.object({
  apiKey: z.string().min(1),
  defaultCity: z.string().min(1),
  cacheTimeout: z.number().min(60000), // 最少1分钟
  units: z.enum(['metric', 'imperial'])
})

export function validateConfig(config: any): WeatherConfig {
  return WeatherConfigSchema.parse(config)
}
```

### 错误处理
实现完善的错误处理机制。

```typescript
import { useLogger } from 'zhin.js'

const logger = useLogger()

class WeatherError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message)
    this.name = 'WeatherError'
  }
}

async function safeGetWeather(city: string): Promise<WeatherData | null> {
  try {
    return await weatherService.getWeather(city)
  } catch (error) {
    if (error instanceof WeatherError) {
      logger.error(`天气服务错误 [${error.code}]:`, error.message)
      return null
    }
    
    logger.error('未知错误:', error)
    throw error
  }
}
```

## 📊 性能优化

### 缓存策略
实现智能缓存机制。

```typescript
class SmartCache<T> {
  private cache = new Map<string, { value: T; expires: number }>()
  
  set(key: string, value: T, ttl: number = 300000): void {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    })
  }
  
  get(key: string): T | null {
    const item = this.cache.get(key)
    if (!item || item.expires < Date.now()) {
      this.cache.delete(key)
      return null
    }
    return item.value
  }
  
  clear(): void {
    this.cache.clear()
  }
  
  cleanup(): void {
    const now = Date.now()
    for (const [key, item] of this.cache) {
      if (item.expires < now) {
        this.cache.delete(key)
      }
    }
  }
}
```

### 异步处理
优化异步操作。

```typescript
import { addMiddleware } from 'zhin.js'

// 异步处理中间件
addMiddleware(async (message, next) => {
  const start = Date.now()
  
  try {
    await next()
  } finally {
    const duration = Date.now() - start
    if (duration > 1000) {
      logger.warn(`慢消息处理: ${message.raw} (${duration}ms)`)
    }
  }
})
```

## 🧪 测试

### 单元测试
为插件编写单元测试。

```typescript
// tests/weather-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { WeatherService } from '../node/plugins/weather/weather-service'

describe('WeatherService', () => {
  let weatherService: WeatherService
  
  beforeEach(() => {
    weatherService = new WeatherService()
  })
  
  it('should get weather data', async () => {
    const weather = await weatherService.getWeather('Beijing')
    expect(weather).toBeDefined()
    expect(weather.city).toBe('Beijing')
  })
  
  it('should cache weather data', async () => {
    const weather1 = await weatherService.getWeather('Beijing')
    const weather2 = await weatherService.getWeather('Beijing')
    
    expect(weather1).toBe(weather2) // 应该返回缓存的数据
  })
})
```

### 集成测试
测试插件与框架的集成。

```typescript
// tests/weather-plugin.test.ts
import { describe, it, expect } from 'vitest'
import { createApp } from 'zhin.js'

describe('Weather Plugin Integration', () => {
  it('should load weather plugin', async () => {
    const app = await createApp({
      plugins: ['weather-plugin']
    })
    
    expect(app).toBeDefined()
    // 测试插件是否正确加载
  })
})
```

## 📦 插件发布

### 包结构
组织插件的包结构。

```
my-weather-plugin/
├── src/
│   ├── index.ts
│   ├── weather-service.ts
│   └── weather-commands.ts
├── dist/                 # 编译输出
├── tests/               # 测试文件
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```

### package.json 配置
```json
{
  "name": "zhin.js-weather",
  "version": "1.0.0",
  "description": "天气查询插件",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "keywords": ["zhin", "plugin", "weather"],
  "peerDependencies": {
    "zhin.js": ">=1.0.0"
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "tsc",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  }
}
```

### 发布流程
```bash
# 构建插件
npm run build

# 运行测试
npm test

# 发布到 NPM
npm publish
```

## 🎛️ 插件配置系统

Zhin.js 提供了强大的配置系统，支持 Schema 定义、类型验证和自动 UI 生成。

### 配置定义与使用流程

#### 1. 使用 `defineSchema` 定义配置结构

`defineSchema` 函数返回一个 schema 函数，用于类型安全的配置访问：

```typescript
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'

const plugin = usePlugin()

// 定义配置 Schema（返回 schema 函数）
const schema = defineSchema(Schema.object({
  // 基础类型
  port: Schema.number('port')
    .default(8086)
    .description('HTTP 服务端口'),
  
  username: Schema.string('username')
    .description('HTTP 基本认证用户名, 默认为当前系统用户名'),
  
  password: Schema.string('password')
    .description('HTTP 基本认证密码, 默认为随机生成的6位字符串'),
  
  base: Schema.string('base')
    .default('/api')
    .description('HTTP 路由前缀, 默认为 /api')
}))
```

#### 2. 使用 schema 函数访问配置

通过调用 schema 函数获取配置值，支持解构赋值、默认值和完整的类型提示：

```typescript
// 方式1: 使用 schema 函数 + 解构赋值 + 默认值
const { 
  port = 8086, 
  username = getCurrentUsername(), 
  password = generateRandomPassword(), 
  base = '/api' 
} = schema(plugin.config, 'http')

// 方式2: 先获取配置对象
const config = schema(plugin.config, 'http')
const port = config.port
const username = config.username

// schema 函数的第二个参数是插件名称，用于从配置对象中提取对应的插件配置
```

**关键要点**：
- `defineSchema` 返回一个 schema 函数
- `schema(plugin.config, 'plugin-name')` 获取配置并提供类型推导
- 支持解构赋值和默认值
- 提供完整的 TypeScript 类型提示

#### 3. 在配置文件中设置值

用户可在 `zhin.config.ts` 中为插件提供配置：

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig(async () => {
  return {
    plugins: ['http', 'my-plugin'],
    
    // 使用插件名作为键配置插件
    http: {
      port: 8086,
      username: process.env.HTTP_USERNAME,
      password: process.env.HTTP_PASSWORD,
      base: '/api'
    },
    
    'my-plugin': {
      apiKey: process.env.API_KEY,
      timeout: 5000
    }
  }
})
```

### 完整的配置示例

参考 HTTP 插件的配置实现：

```typescript
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'
import os from 'node:os'

const plugin = usePlugin()

// 辅助函数
const getCurrentUsername = () => {
  try {
    return os.userInfo().username
  } catch {
    return 'admin'
  }
}

const generateRandomPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 定义 Schema（返回 schema 函数）
const schema = defineSchema(Schema.object({
  port: Schema.number('port')
    .default(8086)
    .description('HTTP 服务端口'),
  
  username: Schema.string('username')
    .description('HTTP 基本认证用户名, 默认为当前系统用户名'),
  
  password: Schema.string('password')
    .description('HTTP 基本认证密码, 默认为随机生成的6位字符串'),
  
  base: Schema.string('base')
    .default('/api')
    .description('HTTP 路由前缀, 默认为 /api')
}))

// 使用 schema 函数获取配置（支持默认值和计算值）
const { 
  port = 8086, 
  username = getCurrentUsername(), 
  password = generateRandomPassword(), 
  base = '/api' 
} = schema(plugin.config, 'http')

// 在代码中使用
console.log(`Server running on port ${port}`)
console.log(`Username: ${username}`)
console.log(`API base: ${base}`)
```

### 支持的 Schema 类型

Zhin.js Schema 系统支持丰富的数据类型：

| 类型 | 方法 | 说明 | Web UI 控件 |
|------|------|------|-------------|
| **基础类型** |
| 字符串 | `Schema.string()` | 文本内容 | TextField / TextArea / Select |
| 数字 | `Schema.number()` | 整数或浮点数 | NumberInput |
| 布尔值 | `Schema.boolean()` | true/false | Switch |
| **特殊类型** |
| 百分比 | `Schema.percent()` | 0-1 之间的小数 | Slider + NumberInput |
| 日期 | `Schema.date()` | Date 对象 | DatePicker |
| 正则 | `Schema.regexp()` | 正则表达式 | TextField (monospace) |
| **集合类型** |
| 数组 | `Schema.list(T)` | 元素列表 | CardList / TextArea |
| 元组 | `Schema.tuple([T1, T2])` | 固定长度数组 | FixedFieldList |
| 对象 | `Schema.object({})` | 键值对 | NestedFields |
| 字典 | `Schema.dict(T)` | 动态键值对 | JSONEditor |
| **逻辑类型** |
| 联合 | `Schema.union([T1, T2])` | 多选一 | Select / Radio |
| 交叉 | `Schema.intersect([T1, T2])` | 合并类型 | MultiFields |
| 任意 | `Schema.any()` | 任意类型 | JSONEditor |

### Schema 方法链

Schema 支持链式调用添加验证规则和元数据：

```typescript
Schema.string('apiKey')
  .required()                      // 必填字段
  .default('sk-xxx')               // 默认值
  .description('OpenAI API密钥')   // 字段描述（用于生成文档和UI）
  .pattern(/^sk-[a-zA-Z0-9]+$/)   // 正则验证
  .min(10)                         // 最小长度
  .max(100)                        // 最大长度

Schema.number('port')
  .min(1024)                       // 最小值
  .max(65535)                      // 最大值
  .default(8080)
  .description('服务端口号')

Schema.list(Schema.string())
  .default([])
  .description('白名单列表')

Schema.object({
  host: Schema.string().default('localhost'),
  port: Schema.number().default(3306)
})
  .description('数据库配置')
```

### 复杂配置示例

#### 嵌套对象配置

```typescript
defineSchema(Schema.object({
  database: Schema.object({
    host: Schema.string('host').default('localhost'),
    port: Schema.number('port').default(3306),
    username: Schema.string('username'),
    password: Schema.string('password'),
    database: Schema.string('database').default('mydb')
  }).description('数据库配置'),
  
  cache: Schema.object({
    enabled: Schema.boolean('enabled').default(true),
    ttl: Schema.number('ttl').default(3600).description('缓存过期时间(秒)')
  }).description('缓存配置')
}))

// 使用
const { database, cache } = plugin.config
console.log(`DB: ${database.host}:${database.port}`)
console.log(`Cache TTL: ${cache.ttl}s`)
```

#### 数组和元组配置

```typescript
defineSchema(Schema.object({
  // 字符串数组
  whitelist: Schema.list(Schema.string())
    .default([])
    .description('用户白名单'),
  
  // 对象数组
  servers: Schema.list(Schema.object({
    name: Schema.string('name'),
    url: Schema.string('url'),
    weight: Schema.number('weight').default(1)
  }))
    .default([])
    .description('服务器列表'),
  
  // 固定长度元组
  coordinates: Schema.tuple([
    Schema.number('latitude'),
    Schema.number('longitude')
  ])
    .default([0, 0])
    .description('地理坐标 [纬度, 经度]')
}))
```

#### 联合类型配置

```typescript
defineSchema(Schema.object({
  // 字符串或数字
  timeout: Schema.union([
    Schema.string('timeout'),
    Schema.number('timeout')
  ])
    .default(5000)
    .description('超时时间（毫秒或时间字符串）'),
  
  // 多个选项
  logLevel: Schema.union([
    Schema.const('debug'),
    Schema.const('info'),
    Schema.const('warn'),
    Schema.const('error')
  ])
    .default('info')
    .description('日志级别')
}))
```

### 配置类型声明

为配置定义 TypeScript 类型以获得完整的类型提示：

```typescript
// 定义配置接口
interface MyPluginConfig {
  port: number
  username?: string
  password?: string
  base: string
  database: {
    host: string
    port: number
    username?: string
    password?: string
  }
}

// 扩展全局类型
declare module '@zhin.js/types' {
  interface AppConfig {
    'my-plugin'?: Partial<MyPluginConfig>
  }
}

// 使用时有完整的类型提示
const config = plugin.config as MyPluginConfig
```

### Web 控制台自动 UI 生成

定义的 Schema 会自动在 Web 控制台生成配置表单：

1. **自动生成表单**: 基于 Schema 类型生成对应的表单控件
2. **实时验证**: 用户输入时进行格式和范围验证
3. **描述提示**: 显示字段描述和帮助信息
4. **嵌套支持**: 支持多层嵌套的对象和数组
5. **即时保存**: 修改后自动保存到配置文件

访问 `http://localhost:8086/` 查看 Web 控制台，在插件详情页可以：
- 查看所有配置项及其说明
- 通过友好的表单修改配置
- 实时预览配置的 JSON
- 一键保存并重载

### 配置的作用域

配置有两个层级：

#### 1. 全局应用配置 (AppConfig)

在 `zhin.config.ts` 的根级别定义，所有插件共享：

```typescript
export default defineConfig({
  log_level: 1,              // 应用级配置
  database: { /* ... */ },   // 应用级配置
  plugins: ['http'],
  
  http: {                    // 插件级配置
    port: 8086
  }
})
```

#### 2. 插件配置

使用插件名作为键，只对该插件生效：

```typescript
export default defineConfig({
  plugins: ['http', 'my-plugin'],
  
  // HTTP 插件配置
  http: {
    port: 8086,
    base: '/api'
  },
  
  // my-plugin 插件配置
  'my-plugin': {
    apiKey: process.env.API_KEY,
    timeout: 5000
  }
})
```

### 配置最佳实践

1. **使用环境变量存储敏感信息**
   ```typescript
   username: process.env.HTTP_USERNAME,
   password: process.env.HTTP_PASSWORD
   ```

2. **提供合理的默认值**
   ```typescript
   port: Schema.number('port').default(8086)
   ```

3. **添加清晰的描述**
   ```typescript
   .description('HTTP 服务端口，范围 1024-65535')
   ```

4. **使用辅助函数计算默认值**
   ```typescript
   const { username = getCurrentUsername() } = schema(plugin.config, 'my-plugin')
   ```

5. **验证配置的有效性**
   ```typescript
   .min(1024).max(65535)  // 端口范围
   .pattern(/^sk-/)       // API 密钥格式
   ```

6. **为复杂配置添加类型声明**
   ```typescript
   interface MyConfig { /* ... */ }
   const config = schema(plugin.config, 'my-plugin') as MyConfig
   ```

### TypeScript 类型提示

`defineSchema` 返回的 schema 函数提供完整的 TypeScript 类型推导：

```typescript
const plugin = usePlugin()

// 定义 schema
const schema = defineSchema(Schema.object({
  apiKey: Schema.string('apiKey'),
  timeout: Schema.number('timeout').default(5000),
  retries: Schema.number('retries').default(3)
}))

// schema 函数会自动推导返回类型
const config = schema(plugin.config, 'my-plugin')
// config 类型: { apiKey: string; timeout: number; retries: number }

// 完整的类型提示和自动补全
const apiKey: string = config.apiKey        // ✅ 类型正确
const timeout: number = config.timeout      // ✅ 类型正确
// const wrong: boolean = config.timeout    // ❌ TypeScript 错误
```

#### 定义配置接口

为更复杂的配置定义专门的接口并扩展全局类型：

```typescript
// 1. 定义配置接口
interface MyPluginConfig {
  apiKey: string
  timeout: number
  retries: number
  database?: {
    host: string
    port: number
  }
}

// 2. 扩展全局类型
declare module '@zhin.js/types' {
  interface AppConfig {
    'my-plugin'?: Partial<MyPluginConfig>
  }
}

// 3. 定义 schema
const schema = defineSchema(Schema.object({
  apiKey: Schema.string('apiKey').required(),
  timeout: Schema.number('timeout').default(5000),
  retries: Schema.number('retries').default(3),
  database: Schema.object({
    host: Schema.string('host').default('localhost'),
    port: Schema.number('port').default(3306)
  }).optional()
}))

// 4. 使用 schema 函数（完整类型提示）
const config = schema(plugin.config, 'my-plugin')

// TypeScript 会提供智能提示和类型检查
const apiKey: string = config.apiKey
const timeout: number = config.timeout
const dbHost: string | undefined = config.database?.host
```

现在在 `zhin.config.ts` 中也会有完整的类型提示：

```typescript
export default defineConfig({
  plugins: ['my-plugin'],
  
  'my-plugin': {
    apiKey: 'sk-xxx',      // ✅ 类型检查
    timeout: 10000,        // ✅ 类型检查
    // invalid: true       // ❌ TypeScript 会报错
  }
})
```


## 🔗 相关链接

- [插件生命周期](./lifecycle.md)
- [上下文系统](./context.md)
- [中间件系统](./middleware.md)
- [定时任务](./cron.md)
- [Schema 系统](../api/types.md#schema)
