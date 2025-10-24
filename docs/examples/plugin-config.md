# 插件配置完整示例

本文档展示了如何在 Zhin.js 中定义和使用插件配置。

## 基础配置流程

### 1. 定义配置 Schema（插件开发者）

在插件代码中使用 `defineSchema` 定义配置结构，它会返回一个 schema 函数用于类型安全的配置访问：

```typescript
// plugins/my-plugin/src/index.ts
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'

const plugin = usePlugin()

// 定义配置 Schema（返回 schema 函数）
const schema = defineSchema(Schema.object({
  apiKey: Schema.string('apiKey')
    .required()
    .description('API 访问密钥'),
  
  timeout: Schema.number('timeout')
    .default(5000)
    .min(1000)
    .max(30000)
    .description('请求超时时间（毫秒）'),
  
  retries: Schema.number('retries')
    .default(3)
    .min(0)
    .max(10)
    .description('失败重试次数')
}))

// 使用 schema 函数获取配置（带类型提示和默认值）
const { apiKey, timeout = 5000, retries = 3 } = schema(plugin.config, 'my-plugin')

console.log(`API Key: ${apiKey}`)
console.log(`Timeout: ${timeout}ms`)
console.log(`Retries: ${retries}`)
```

**关键要点**：
- `defineSchema` 返回一个 schema 函数
- 使用 `schema(plugin.config, 'plugin-name')` 获取配置
- 第二个参数是插件名称，用于从配置对象中提取对应的插件配置
- 支持解构赋值和默认值
- 提供完整的 TypeScript 类型提示

### 2. 提供配置值（用户）

在 `zhin.config.ts` 中为插件提供配置：

```typescript
// zhin.config.ts
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: ['my-plugin'],
  
  // 使用插件名作为键
  'my-plugin': {
    apiKey: process.env.MY_PLUGIN_API_KEY,
    timeout: 10000,
    retries: 5
  }
})
```

## 实际案例：HTTP 插件

### 插件定义（plugins/http/src/index.ts）

```typescript
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'
import os from 'node:os'

const plugin = usePlugin()

// 辅助函数：获取当前系统用户名
const getCurrentUsername = () => {
  try {
    return os.userInfo().username
  } catch {
    return 'admin'
  }
}

// 辅助函数：生成随机密码
const generateRandomPassword = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// 定义配置 Schema（返回 schema 函数）
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

// 使用 schema 函数获取配置（带类型提示和计算默认值）
const { 
  port = 8086, 
  username = getCurrentUsername(), 
  password = generateRandomPassword(), 
  base = '/api' 
} = schema(plugin.config, 'http')

// 启动服务器
console.log(`Server running on port ${port}`)
console.log(`Username: ${username}`)
console.log(`Password: ${password}`)
console.log(`API base: ${base}`)
```

### 用户配置（zhin.config.ts）

```typescript
import { defineConfig } from 'zhin.js'

export default defineConfig({
  plugins: ['http', 'adapter-process', 'console'],
  
  http: {
    port: 8086,
    username: process.env.HTTP_USERNAME,
    password: process.env.HTTP_PASSWORD,
    base: '/api'
  }
})
```

### 环境变量（.env）

```bash
HTTP_USERNAME=admin
HTTP_PASSWORD=secret123
```

## Schema 类型详解

### 基础类型

```typescript
// 定义 schema 函数
const schema = defineSchema(Schema.object({
  // 字符串
  name: Schema.string('name')
    .default('default')
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z]+$/)
    .description('用户名'),
  
  // 数字
  age: Schema.number('age')
    .default(18)
    .min(0)
    .max(150)
    .description('年龄'),
  
  // 布尔值
  enabled: Schema.boolean('enabled')
    .default(true)
    .description('是否启用')
}))

// 使用 schema 函数获取配置
const { name, age, enabled } = schema(plugin.config, 'my-plugin')
```

### 特殊类型

```typescript
const schema = defineSchema(Schema.object({
  // 百分比（0-1之间的小数）
  successRate: Schema.percent('successRate')
    .default(0.8)
    .description('成功率'),
  
  // 日期
  createdAt: Schema.date('createdAt')
    .default(new Date())
    .description('创建时间'),
  
  // 正则表达式
  pattern: Schema.regexp('pattern')
    .default(/.*/)
    .description('匹配模式')
}))

const { successRate, createdAt, pattern } = schema(plugin.config, 'my-plugin')
```

### 集合类型

```typescript
const schema = defineSchema(Schema.object({
  // 字符串数组
  tags: Schema.list(Schema.string())
    .default([])
    .description('标签列表'),
  
  // 数字数组
  scores: Schema.list(Schema.number())
    .default([])
    .description('分数列表'),
  
  // 对象数组
  users: Schema.list(Schema.object({
    name: Schema.string('name'),
    age: Schema.number('age')
  }))
    .default([])
    .description('用户列表'),
  
  // 固定长度元组
  coordinates: Schema.tuple([
    Schema.number('latitude'),
    Schema.number('longitude')
  ])
    .default([0, 0])
    .description('地理坐标 [纬度, 经度]')
}))

const { tags, scores, users, coordinates } = schema(plugin.config, 'my-plugin')
```

### 嵌套对象

```typescript
const schema = defineSchema(Schema.object({
  database: Schema.object({
    host: Schema.string('host').default('localhost'),
    port: Schema.number('port').default(3306),
    username: Schema.string('username'),
    password: Schema.string('password'),
    database: Schema.string('database').default('mydb')
  }).description('数据库配置'),
  
  cache: Schema.object({
    enabled: Schema.boolean('enabled').default(true),
    ttl: Schema.number('ttl').default(3600),
    maxSize: Schema.number('maxSize').default(1000)
  }).description('缓存配置')
}))

// 使用 schema 函数获取嵌套配置
const { database, cache } = schema(plugin.config, 'my-plugin')
console.log(`DB: ${database.host}:${database.port}`)
console.log(`Cache enabled: ${cache.enabled}`)
```

### 联合类型

```typescript
const schema = defineSchema(Schema.object({
  // 字符串或数字
  timeout: Schema.union([
    Schema.string('timeout'),
    Schema.number('timeout')
  ])
    .default(5000)
    .description('超时时间（毫秒或时间字符串如 "5s"）'),
  
  // 枚举选项
  logLevel: Schema.union([
    Schema.const('debug'),
    Schema.const('info'),
    Schema.const('warn'),
    Schema.const('error')
  ])
    .default('info')
    .description('日志级别'),
  
  // 多个对象类型
  storage: Schema.union([
    Schema.object({
      type: Schema.const('local'),
      path: Schema.string('path')
    }),
    Schema.object({
      type: Schema.const('s3'),
      bucket: Schema.string('bucket'),
      region: Schema.string('region')
    })
  ])
    .description('存储配置')
}))

const { timeout, logLevel, storage } = schema(plugin.config, 'my-plugin')
```

### 字典类型

```typescript
const schema = defineSchema(Schema.object({
  // 动态键值对
  labels: Schema.dict(Schema.string())
    .default({})
    .description('标签映射'),
  
  metadata: Schema.dict(Schema.any())
    .default({})
    .description('元数据')
}))

// 使用 schema 函数获取字典配置
const { labels, metadata } = schema(plugin.config, 'my-plugin')
// labels = { "env": "production", "team": "backend" }
// metadata = { "version": "1.0.0", "buildDate": "2024-01-01" }
```

## 高级用法

### 条件默认值

```typescript
const plugin = usePlugin()

const schema = defineSchema(Schema.object({
  port: Schema.number('port').description('服务端口'),
  host: Schema.string('host').description('服务主机'),
  env: Schema.union([
    Schema.const('development'),
    Schema.const('production')
  ]).default('development')
}))

// 使用 schema 函数并根据环境提供不同的默认值
const config = schema(plugin.config, 'my-plugin')
const env = config.env || 'development'
const {
  port = env === 'development' ? 3000 : 8080,
  host = env === 'development' ? 'localhost' : '0.0.0.0'
} = config
```

### 配置验证和错误处理

```typescript
const plugin = usePlugin()

const schema = defineSchema(Schema.object({
  apiKey: Schema.string('apiKey')
    .required()
    .pattern(/^sk-[a-zA-Z0-9]+$/)
    .description('API密钥（格式：sk-xxx）'),
  
  maxConnections: Schema.number('maxConnections')
    .min(1)
    .max(100)
    .default(10)
}))

// 使用 schema 函数获取并验证配置
const { apiKey, maxConnections = 10 } = schema(plugin.config, 'my-plugin')

if (!apiKey) {
  throw new Error('apiKey is required in plugin configuration')
}

if (!/^sk-/.test(apiKey)) {
  throw new Error('apiKey must start with "sk-"')
}

console.log(`Valid API Key: ${apiKey.substring(0, 10)}...`)
console.log(`Max Connections: ${maxConnections}`)
```

### TypeScript 类型支持

#### 基础用法

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

#### 配置接口定义

为更复杂的配置定义专门的接口：

```typescript
// 定义配置接口
interface MyPluginConfig {
  apiKey: string
  timeout: number
  retries: number
  database?: {
    host: string
    port: number
  }
}

// 定义 schema
const schema = defineSchema(Schema.object({
  apiKey: Schema.string('apiKey').required(),
  timeout: Schema.number('timeout').default(5000),
  retries: Schema.number('retries').default(3),
  database: Schema.object({
    host: Schema.string('host').default('localhost'),
    port: Schema.number('port').default(3306)
  }).optional()
}))

// 使用时有完整的类型提示
const plugin = usePlugin()
const config = schema(plugin.config, 'my-plugin') as MyPluginConfig

// TypeScript 会提供智能提示和类型检查
const apiKey: string = config.apiKey
const timeout: number = config.timeout
const dbHost: string | undefined = config.database?.host
```

#### 全局类型扩展

扩展全局 AppConfig 类型，使配置文件也有类型提示：

```typescript
// 在插件文件中扩展类型
declare module '@zhin.js/types' {
  interface AppConfig {
    'my-plugin'?: Partial<MyPluginConfig>
  }
}

// 现在在 zhin.config.ts 中会有完整的类型提示
export default defineConfig({
  plugins: ['my-plugin'],
  
  'my-plugin': {
    apiKey: 'sk-xxx',      // ✅ 类型检查
    timeout: 10000,        // ✅ 类型检查
    // invalid: true       // ❌ TypeScript 会报错
  }
})
```

#### Schema 函数的类型签名

```typescript
// defineSchema 返回的 schema 函数签名
type SchemaFunction<T> = (config: any, pluginName: string) => T

// 示例
const schema = defineSchema(Schema.object({
  port: Schema.number('port').default(8080),
  host: Schema.string('host').default('localhost')
}))

// schema 的类型
// (config: any, pluginName: string) => { port: number; host: string }
```

#### 完整的类型安全示例

```typescript
import { defineSchema, Schema, usePlugin } from '@zhin.js/core'

// 1. 定义配置接口
interface HttpPluginConfig {
  port: number
  username: string
  password: string
  base: string
}

// 2. 扩展全局类型
declare module '@zhin.js/types' {
  interface AppConfig {
    http?: Partial<HttpPluginConfig>
  }
}

// 3. 在插件中定义 schema
const plugin = usePlugin()

const schema = defineSchema(Schema.object({
  port: Schema.number('port').default(8086),
  username: Schema.string('username'),
  password: Schema.string('password'),
  base: Schema.string('base').default('/api')
}))

// 4. 使用 schema 获取配置（完整类型提示）
const config = schema(plugin.config, 'http')

// 5. TypeScript 会验证类型
const port: number = config.port           // ✅ 正确
const username: string = config.username   // ✅ 正确
// const wrong: boolean = config.port      // ❌ 编译错误

// 6. 解构也有类型提示
const { port: serverPort, base } = config
// serverPort: number
// base: string
```

## Web 控制台集成

定义的 Schema 会自动在 Web 控制台生成配置表单。

### 自动 UI 生成

访问 `http://localhost:8086/` 后：

1. 进入插件管理页面
2. 选择要配置的插件
3. 查看自动生成的配置表单
4. 修改配置值
5. 保存后自动更新到配置文件

### UI 控件映射

| Schema 类型 | Web UI 控件 | 说明 |
|------------|------------|------|
| `string` | TextField | 单行文本输入 |
| `string` (长文本) | TextArea | 多行文本输入 |
| `number` | NumberInput | 数字输入（带范围限制） |
| `boolean` | Switch | 开关按钮 |
| `percent` | Slider + NumberInput | 滑块和数字输入组合 |
| `date` | DatePicker | 日期选择器 |
| `regexp` | TextField (monospace) | 正则表达式输入 |
| `list` | CardList / TextArea | 动态列表编辑器 |
| `tuple` | FixedFieldList | 固定长度字段列表 |
| `object` | NestedFields | 嵌套表单 |
| `dict` | JSONEditor | JSON 编辑器 |
| `union` | Select / Radio | 下拉选择或单选按钮 |

### 表单验证

Web 控制台会根据 Schema 定义自动进行验证：

- **必填检查**：`required()` 的字段必须填写
- **范围检查**：`min()` / `max()` 限制数值范围
- **格式检查**：`pattern()` 验证字符串格式
- **类型检查**：确保输入值符合定义的类型

## 最佳实践

### 1. 使用环境变量存储敏感信息

```typescript
// zhin.config.ts
export default defineConfig({
  'my-plugin': {
    apiKey: process.env.API_KEY,  // 不要硬编码
    apiSecret: process.env.API_SECRET
  }
})
```

### 2. 提供合理的默认值

```typescript
defineSchema(Schema.object({
  timeout: Schema.number('timeout')
    .default(5000)  // 合理的默认值
    .description('请求超时时间（毫秒）'),
  
  retries: Schema.number('retries')
    .default(3)
    .min(0)
    .max(10)
}))
```

### 3. 添加清晰的描述

```typescript
defineSchema(Schema.object({
  port: Schema.number('port')
    .default(8086)
    .description('HTTP 服务端口，范围 1024-65535'),  // 清晰的描述
  
  maxConnections: Schema.number('maxConnections')
    .default(100)
    .description('最大并发连接数，建议根据服务器性能调整')
}))
```

### 4. 使用辅助函数计算默认值

```typescript
const getCurrentUsername = () => {
  try {
    return os.userInfo().username
  } catch {
    return 'admin'
  }
}

// 使用辅助函数提供动态默认值
const { username = getCurrentUsername() } = plugin.config
```

### 5. 验证配置的有效性

```typescript
defineSchema(Schema.object({
  port: Schema.number('port')
    .min(1024)              // 端口范围验证
    .max(65535)
    .default(8086),
  
  apiKey: Schema.string('apiKey')
    .required()             // 必填验证
    .pattern(/^sk-/)        // 格式验证
    .min(20)                // 长度验证
}))
```

### 6. 组织复杂配置

```typescript
// 将复杂配置拆分为多个子对象
defineSchema(Schema.object({
  server: Schema.object({
    port: Schema.number('port').default(8080),
    host: Schema.string('host').default('0.0.0.0')
  }).description('服务器配置'),
  
  database: Schema.object({
    host: Schema.string('host').default('localhost'),
    port: Schema.number('port').default(3306)
  }).description('数据库配置'),
  
  cache: Schema.object({
    enabled: Schema.boolean('enabled').default(true),
    ttl: Schema.number('ttl').default(3600)
  }).description('缓存配置')
}))
```

## 相关文档

- [插件开发指南](../plugin/development.md)
- [配置说明](../guide/configuration.md)
- [Schema 系统](../guide/schema-system.md)
- [Web 控制台](../official/plugins.md#console-插件)
