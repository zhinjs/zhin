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
import { WeatherService } from '../src/plugins/weather/weather-service'

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
  "name": "@your-org/zhin-plugin-weather",
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

### 使用 Schema 定义配置

Zhin.js 提供了强大的 Schema 系统，支持 15 种数据类型和自动表单生成。

```typescript
import { Schema } from 'zhin.js'

// 定义插件配置
export const config = Schema.object({
  // 基础类型
  apiKey: Schema.string('API密钥')
    .required()
    .description('服务API密钥'),
  
  maxRetries: Schema.number('最大重试次数')
    .min(0)
    .max(10)
    .default(3),
  
  enabled: Schema.boolean('是否启用')
    .default(true),
  
  // 特殊类型
  timeout: Schema.percent('超时比例')
    .default(0.8)
    .description('请求超时占总时间的比例'),
  
  // 集合类型
  whitelist: Schema.list(Schema.string(), '白名单')
    .description('允许访问的用户ID列表'),
  
  server: Schema.object({
    host: Schema.string('主机').default('localhost'),
    port: Schema.number('端口').default(8080)
  })
})

// 使用配置
import { useConfig } from 'zhin.js'

const config = useConfig('my-plugin')
console.log(config.apiKey)  // 访问配置值
```

### 支持的 Schema 类型

| 类型 | 说明 | UI 控件 |
|------|------|---------|
| `string` | 字符串 | TextField / TextArea / Select |
| `number` | 数字 | NumberInput |
| `boolean` | 布尔值 | Switch |
| `percent` | 百分比 | Slider + NumberInput |
| `date` | 日期 | DatePicker |
| `regexp` | 正则表达式 | TextField (monospace) |
| `list` | 列表 | TextArea / CardList |
| `tuple` | 元组 | FixedFieldList |
| `object` | 对象 | NestedFields |
| `dict` | 字典 | JSONEditor |
| `union` | 联合类型 | Select |
| `intersect` | 交叉类型 | MultiFields |
| `any` | 任意类型 | JSONEditor |

### 配置元数据

```typescript
Schema.string('fieldName')
  .required()                    // 必填
  .default('defaultValue')       // 默认值
  .description('Field help text') // 描述信息
  .min(0).max(100)              // 数值范围
  .pattern('^[a-z]+$')          // 正则验证
  .enum(['a', 'b', 'c'])        // 枚举选项
```

### Web 控制台集成

配置的 Schema 会自动在 Web 控制台的插件详情页生成配置表单，用户可以：
- 查看所有配置项和说明
- 通过友好的 UI 修改配置
- 实时保存到配置文件
- 支持嵌套结构和复杂类型


## 🔗 相关链接

- [插件生命周期](./lifecycle.md)
- [上下文系统](./context.md)
- [中间件系统](./middleware.md)
- [定时任务](./cron.md)
- [Schema 系统](../api/types.md#schema)
