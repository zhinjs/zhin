# @zhin.js/logger

Zhin 机器人框架的结构化日志系统，提供多级别、多传输器、可格式化的日志功能。

## 特性

- 📊 **多日志级别** - debug、info、success、warn、error
- 🎨 **彩色输出** - 自动为不同级别添加颜色
- 📝 **多种传输器** - Console、File、Stream等
- 🔧 **可自定义格式化器** - 支持自定义日志格式
- ⏱️ **性能计时** - 内置 time/timeEnd 计时功能
- 🏷️ **命名日志器** - 为不同模块创建独立的日志器
- 🔒 **类型安全** - 完整的 TypeScript 类型支持

## 安装

```bash
pnpm add @zhin.js/logger
```

## 快速开始

### 基本使用

```typescript
import logger from '@zhin.js/logger'

// 不同级别的日志
logger.debug('调试信息')
logger.info('普通信息')
logger.success('成功信息')
logger.warn('警告信息')
logger.error('错误信息')

// 带参数的日志
logger.info('用户登录', { userId: 123, username: 'john' })

// 记录错误对象
try {
  throw new Error('Something went wrong')
} catch (error) {
  logger.error('操作失败', error)
}
```

### 便捷函数

```typescript
import { debug, info, success, warn, error } from '@zhin.js/logger'

debug('调试信息')
info('普通信息')
success('成功信息')
warn('警告信息')
error('错误信息')
```

## API 参考

### Logger 类

```typescript
import { Logger } from '@zhin.js/logger'

// 创建日志器实例
const logger = new Logger({
  name: 'MyApp',
  level: 'info',
  transports: [
    new ConsoleTransport(),
    new FileTransport({ file: './logs/app.log' })
  ]
})
```

### 日志级别

```typescript
import { LogLevel } from '@zhin.js/logger'

// 日志级别枚举
LogLevel.DEBUG   // 0 - 调试信息
LogLevel.INFO    // 1 - 普通信息
LogLevel.SUCCESS // 2 - 成功信息
LogLevel.WARN    // 3 - 警告信息
LogLevel.ERROR   // 4 - 错误信息
```

### 日志方法

```typescript
// 基本日志方法
logger.debug(message: string, ...args: any[])
logger.info(message: string, ...args: any[])
logger.success(message: string, ...args: any[])
logger.warn(message: string, ...args: any[])
logger.error(message: string, ...args: any[])

// 计时方法
logger.time(label: string)      // 开始计时
logger.timeEnd(label: string)   // 结束计时并输出耗时
```

### 传输器（Transports）

#### ConsoleTransport

输出日志到控制台：

```typescript
import { ConsoleTransport } from '@zhin.js/logger'

const transport = new ConsoleTransport({
  level: 'debug',  // 最小日志级别
  colors: true     // 启用颜色
})
```

#### FileTransport

输出日志到文件：

```typescript
import { FileTransport } from '@zhin.js/logger'

const transport = new FileTransport({
  file: './logs/app.log',
  level: 'info',
  maxSize: 10 * 1024 * 1024,  // 10MB
  maxFiles: 5                  // 保留5个文件
})
```

#### StreamTransport

输出日志到流：

```typescript
import { StreamTransport } from '@zhin.js/logger'
import * as fs from 'fs'

const stream = fs.createWriteStream('./logs/app.log', { flags: 'a' })
const transport = new StreamTransport({
  stream,
  level: 'info'
})
```

### 自定义传输器

```typescript
import { LogTransport, LogEntry } from '@zhin.js/logger'

class CustomTransport implements LogTransport {
  log(entry: LogEntry): void {
    // 自定义日志处理逻辑
    console.log(`[${entry.level}] ${entry.message}`)
  }
}

logger.addTransport(new CustomTransport())
```

### 格式化器（Formatter）

```typescript
import { LogFormatter, LogEntry } from '@zhin.js/logger'

const customFormatter: LogFormatter = (entry: LogEntry) => {
  const timestamp = new Date(entry.timestamp).toISOString()
  return `[${timestamp}] [${entry.level}] ${entry.message}`
}

logger.setFormatter(customFormatter)
```

### 命名日志器

为不同模块创建独立的日志器：

```typescript
import { getLogger } from '@zhin.js/logger'

const dbLogger = getLogger('Database')
const apiLogger = getLogger('API')
const pluginLogger = getLogger('Plugin')

dbLogger.info('数据库连接成功')
apiLogger.info('API服务器启动')
pluginLogger.info('插件加载完成')
```

输出：

```
[Database] 数据库连接成功
[API] API服务器启动
[Plugin] 插件加载完成
```

### 全局配置

```typescript
import { setLevel, setName, setOptions, setFormatter } from '@zhin.js/logger'

// 设置全局日志级别
setLevel('info')

// 设置全局日志器名称
setName('MyApp')

// 设置全局选项
setOptions({
  level: 'debug',
  colors: true
})

// 设置全局格式化器
setFormatter((entry) => {
  return `${entry.timestamp} - ${entry.message}`
})
```

### 添加/移除传输器

```typescript
import { addTransport, removeTransport, ConsoleTransport } from '@zhin.js/logger'

const transport = new ConsoleTransport()

// 添加传输器
addTransport(transport)

// 移除传输器
removeTransport(transport)
```

### 检查日志级别

```typescript
import { isLevelEnabled, getLevel } from '@zhin.js/logger'

// 检查某个级别是否启用
if (isLevelEnabled('debug')) {
  logger.debug('调试信息')
}

// 获取当前日志级别
const level = getLevel()
console.log('当前日志级别:', level)
```

## 高级用法

### 性能计时

```typescript
// 测量代码块执行时间
logger.time('数据库查询')

// 执行耗时操作
await db.query('SELECT * FROM users')

logger.timeEnd('数据库查询')
// 输出: 数据库查询: 123.45ms
```

### 结构化日志

```typescript
// 记录结构化数据
logger.info('用户操作', {
  action: 'login',
  userId: 123,
  ip: '192.168.1.1',
  timestamp: Date.now()
})
```

### 条件日志

```typescript
// 只在特定条件下记录日志
if (process.env.NODE_ENV === 'development') {
  logger.debug('开发环境调试信息')
}

// 使用日志级别控制
setLevel(process.env.LOG_LEVEL || 'info')
```

## 日志级别说明

| 级别 | 值 | 用途 | 颜色 |
|------|-----|------|------|
| DEBUG | 0 | 详细的调试信息 | 灰色 |
| INFO | 1 | 一般信息 | 蓝色 |
| SUCCESS | 2 | 成功信息 | 绿色 |
| WARN | 3 | 警告信息 | 黄色 |
| ERROR | 4 | 错误信息 | 红色 |

## 类型定义

### LogEntry

```typescript
interface LogEntry {
  level: string
  message: string
  timestamp: number
  args?: any[]
  name?: string
}
```

### LogFormatter

```typescript
type LogFormatter = (entry: LogEntry) => string
```

### LogTransport

```typescript
interface LogTransport {
  log(entry: LogEntry): void
}
```

### LoggerOptions

```typescript
interface LoggerOptions {
  name?: string
  level?: string
  transports?: LogTransport[]
  formatter?: LogFormatter
  colors?: boolean
}
```

## 最佳实践

### 1. 使用命名日志器

为不同模块使用不同的日志器：

```typescript
// database.ts
const logger = getLogger('Database')

// api.ts
const logger = getLogger('API')

// plugin.ts
const logger = getLogger('Plugin')
```

### 2. 适当的日志级别

```typescript
// ❌ 不好
logger.info('变量值:', someVariable)

// ✅ 好
logger.debug('变量值:', someVariable)

// ❌ 不好
logger.error('用户登录成功')

// ✅ 好
logger.success('用户登录成功')
```

### 3. 记录错误上下文

```typescript
// ❌ 不好
logger.error('操作失败')

// ✅ 好
logger.error('用户注册失败', {
  username: 'john',
  error: error.message,
  stack: error.stack
})
```

### 4. 使用计时器测量性能

```typescript
logger.time('数据处理')

// 执行操作
await processData(data)

logger.timeEnd('数据处理')
```

### 5. 生产环境配置

```typescript
// 生产环境使用较高的日志级别
if (process.env.NODE_ENV === 'production') {
  setLevel('warn')
} else {
  setLevel('debug')
}
```

## 常见问题

### 如何禁用颜色？

```typescript
setOptions({ colors: false })
```

### 如何只输出到文件？

```typescript
import { removeTransport, ConsoleTransport } from '@zhin.js/logger'

// 移除控制台传输器
const consoleTransport = /* 获取控制台传输器实例 */
removeTransport(consoleTransport)

// 只添加文件传输器
addTransport(new FileTransport({ file: './app.log' }))
```

### 如何获取所有日志器名称？

```typescript
import { getLoggerNames } from '@zhin.js/logger'

const names = getLoggerNames()
console.log('所有日志器:', names)
```

## 相关资源

- [完整文档](https://docs.zhin.dev)
- [API 参考](https://docs.zhin.dev/api/logger)
- [示例代码](https://docs.zhin.dev/examples/logger)

## 许可证

MIT License
