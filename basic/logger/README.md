# @zhin.js/logger

轻量级、高性能的日志库，为 Zhin Endpoint Framework 提供完整的日志记录功能。

## ✨ 特性

- 🎯 **轻量级**: 仅依赖 chalk，无额外第三方库
- 🎨 **自定义格式**: 【date】【level】【name】：【message】
- 🌈 **智能着色**: 自动为不同级别和名称分配颜色
- 🎨 **颜色自定义**: 完全自定义级别、名称、日期颜色（新功能）
- 📊 **多输出支持**: 控制台、文件、流等多种输出方式
- ⚡ **性能监控**: 内置高精度计时功能
- 🎯 **命名空间**: 支持分层次的 Logger 命名空间
- 🛡️ **类型安全**: 完整的 TypeScript 类型支持
- 🔄 **智能继承**: 子Logger自动继承父Logger配置

## 📦 安装

```bash
pnpm add @zhin.js/logger
```

## 🚀 快速开始

### 基础用法

```typescript
import { getLogger, info, success, warn, error } from '@zhin.js/logger'

// 使用便捷函数（默认 logger）
info('应用启动')
success('操作成功')
warn('警告信息')
error('错误信息')

// 创建命名空间 Logger
const logger = getLogger('MyApp')
logger.info('这是来自 MyApp 的日志')
```

### 输出格式

```
[09-08 04:07:55.852] [INFO] [MyApp]: 应用启动
[09-08 04:07:55.854] [WARN] [Database]: 连接超时
[09-08 04:07:55.855] [ERROR] [Auth]: 用户验证失败
```

- **日期格式**: `MM-dd HH:MM:ss.SSS`
- **级别着色**: DEBUG(灰), INFO(蓝), WARN(黄), ERROR(红)
- **名称着色**: 自动为不同名称分配颜色，便于区分

## 📖 详细用法

### 1. 日志级别

```typescript
import { getLogger, LogLevel } from '@zhin.js/logger'

const logger = getLogger('Test')

logger.debug('调试信息')   // 灰色
logger.info('一般信息')    // 蓝色
logger.warn('警告信息')    // 黄色
logger.error('错误信息')   // 红色
logger.success('成功信息') // INFO级别，带绿色✓标记

// 设置日志级别
logger.setLevel(LogLevel.WARN) // 只显示 WARN 和 ERROR
```

### 2. 命名空间和子 Logger

```typescript
const appLogger = getLogger('App')
const dbLogger = appLogger.getLogger('Database')       // 自动继承父级配置
const apiLogger = appLogger.getLogger('API')

appLogger.info('主应用日志')         // [App]: ...
dbLogger.info('数据库日志')         // [App:Database]: ...
apiLogger.info('API日志')           // [App:API]: ...

// 多层嵌套
const httpLogger = apiLogger.getLogger('HTTP')
const routerLogger = httpLogger.getLogger('Router')
httpLogger.info('HTTP服务启动')      // [App:API:HTTP]: ...
routerLogger.info('路由就绪')        // [App:API:HTTP:Router]: ...
```

### 3. 参数格式化

```typescript
const logger = getLogger('Format')

// 支持 printf 风格的格式化，与 console.info 行为一致
logger.info('用户 %s 登录成功，ID: %d', 'John', 123)
logger.warn('连接超时，重试 %d/%d', 3, 5)
logger.error('操作失败：%o', { code: 500, message: 'Server Error' })
```

### 4. 性能监控

```typescript
const logger = getLogger('Performance')

// 方式1：使用返回的 Timer
const timer = logger.time('数据处理')
// ... 执行操作
timer.end() // 输出: 数据处理 took 123.45ms

// 方式2：使用 timeEnd
logger.time('API调用')
// ... 执行操作
logger.timeEnd('API调用') // 输出: API调用 took 67.89ms
```

### 5. 配置继承与覆盖

```typescript
const appLogger = getLogger('App')

// 子 Logger 自动继承父级配置
const dbLogger = appLogger.getLogger('Database') 
// dbLogger 继承了 appLogger 的级别、格式化器、输出器

// 递归设置级别（影响所有子 Logger）
appLogger.setLevel(LogLevel.WARN, true)

// 创建时覆盖特定配置
const debugLogger = appLogger.getLogger('Debug', {
  level: LogLevel.DEBUG  // 覆盖父级的 WARN 级别
})

// 父子关系管理
console.log(dbLogger.getParent()?.getName())     // 'App'
console.log(appLogger.isRoot())                  // true
console.log(appLogger.getChildLoggerNames())     // ['Database', 'Debug']
```

### 6. 文件输出

```typescript
import fs from 'node:fs'
import { getLogger, FileTransport, ConsoleTransport } from '@zhin.js/logger'

const logFile = fs.createWriteStream('./app.log', { flags: 'a' })

const logger = getLogger('FileApp', {
  transports: [
    new ConsoleTransport(),           // 控制台输出（带颜色）
    new FileTransport(logFile)        // 文件输出（无颜色）
  ]
})

logger.info('这条日志会同时输出到控制台和文件')

// 递归添加输出器到所有子 Logger
logger.addTransport(new FileTransport(logFile), true)
```

### 7. 自定义格式化器

```typescript
import { getLogger, LogFormatter } from '@zhin.js/logger'

class CustomFormatter implements LogFormatter {
  format(entry) {
    const { level, name, message, timestamp } = entry
    return `${timestamp.toISOString()} [${name}] ${message}`
  }
}

const logger = getLogger('Custom', {
  formatter: new CustomFormatter()
})

// 递归设置格式化器到所有子 Logger
logger.setFormatter(new CustomFormatter(), true)

logger.info('自定义格式的日志')
```

### 8. 流输出

```typescript
import { getLogger, StreamTransport } from '@zhin.js/logger'

const logger = getLogger('StreamApp', {
  transports: [
    new StreamTransport(process.stdout, false), // 保留颜色
    new StreamTransport(process.stderr, true)   // 移除颜色
  ]
})
```

### 9. 自定义颜色配置 🎨

完全自定义Logger的颜色方案，让不同模块、环境、团队成员拥有独特的视觉效果。

#### 基础颜色自定义
```typescript
import { getLogger, LogLevel } from '@zhin.js/logger'
import chalk from 'chalk'

const logger = getLogger('MyApp', {
  colors: {
    // 自定义级别颜色
    levelColors: {
      [LogLevel.INFO]: chalk.magenta.bold,
      [LogLevel.WARN]: chalk.cyan,
      [LogLevel.ERROR]: chalk.green.bold.underline
    },
    // 自定义名称颜色（单色或多色循环）
    nameColor: chalk.blue.bold,
    // 自定义日期颜色
    dateColor: chalk.yellow
  }
})
```

#### 团队协作颜色分配
```typescript
// 为不同开发者分配专属颜色
const aliceLogger = getLogger('Alice', {
  colors: { nameColor: chalk.magenta.bold }
})
const bobLogger = getLogger('Bob', {
  colors: { nameColor: chalk.cyan.bold }
})
```

#### 模块功能分类
```typescript
// 数据库模块 - 蓝色主题
const dbLogger = getLogger('Database', {
  colors: {
    levelColors: { [LogLevel.INFO]: chalk.blue.bold },
    nameColor: chalk.blue
  }
})

// 安全模块 - 红色警告主题  
const securityLogger = getLogger('Security', {
  colors: {
    levelColors: { 
      [LogLevel.ERROR]: chalk.red.bold.bgYellow 
    },
    nameColor: chalk.red.bold
  }
})
```

#### 多色循环配置
```typescript
const multiColorLogger = getLogger('Development', {
  colors: {
    nameColor: [
      chalk.red.bold,
      chalk.green.bold, 
      chalk.blue.bold,
      chalk.magenta.bold
    ]
  }
})

// 每个子Logger将循环使用不同颜色
const router = multiColorLogger.getLogger('Router')     // 红色
const service = multiColorLogger.getLogger('Service')   // 绿色
const utils = multiColorLogger.getLogger('Utils')       // 蓝色
```

#### 继承与覆盖
```typescript
// 父Logger配置
const parent = getLogger('Parent', {
  colors: {
    dateColor: chalk.blue,
    nameColor: chalk.magenta.bold
  }
})

// 子Logger继承配置
const child1 = parent.getLogger('Child1') // 完全继承

// 子Logger部分覆盖
const child2 = parent.getLogger('Child2', {
  colors: {
    levelColors: { [LogLevel.INFO]: chalk.red.bold }
    // dateColor和nameColor继承自父Logger
  }
})
```

> 📖 **详细文档**: 查看 [CUSTOM_COLORS.md](./CUSTOM_COLORS.md) 了解更多颜色配置示例和最佳实践

## ⚙️ 全局配置

### 设置全局日志级别

```typescript
import { setLevel, LogLevel } from '@zhin.js/logger'

// 设置默认 logger 的日志级别
setLevel(LogLevel.WARN)
```

### 设置全局格式化器

```typescript
import { setFormatter, DefaultFormatter } from '@zhin.js/logger'

const customFormatter = new DefaultFormatter()
setFormatter(customFormatter)
```

### 添加全局输出器

```typescript
import { addGlobalTransport, FileTransport } from '@zhin.js/logger'
import fs from 'node:fs'

const globalLogFile = fs.createWriteStream('./global.log', { flags: 'a' })
addGlobalTransport(new FileTransport(globalLogFile))
```

## 📚 API 参考

### LogLevel 枚举

```typescript
enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}
```

### Logger 类

```typescript
class Logger {
  // 构造函数
  constructor(name: string, options?: LoggerOptions, parent?: Logger)
  
  // 日志方法
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  success(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  error(message: string, ...args: any[]): void
  
  // 子 Logger 管理（新架构核心功能）
  getLogger(namespace: string, options?: LoggerOptions): Logger
  removeChildLogger(namespace: string): boolean
  getChildLoggerNames(): string[]
  getParent(): Logger | undefined
  isRoot(): boolean
  
  // 配置管理（支持递归操作）
  setLevel(level: LogLevel, recursive?: boolean): void
  setFormatter(formatter: LogFormatter, recursive?: boolean): void
  addTransport(transport: LogTransport, recursive?: boolean): void
  removeTransport(transport: LogTransport, recursive?: boolean): void
  
  // 工具方法
  getLevel(): LogLevel
  isLevelEnabled(level: LogLevel): boolean
  time(label: string): Timer
  timeEnd(label: string): void
  logIf(condition: boolean, level: LogLevel, message: string, ...args: any[]): void
  getName(): string
}
```

### 便捷函数

```typescript
// Logger 管理（新架构）
function getLogger(name: string, options?: LoggerOptions): Logger
function getDefaultLogger(): Logger
function getLogger(name: string, options?: LoggerOptions, parent?: Logger): Logger
function setLogger(name: string, options?: LoggerOptions, parent?: Logger): Logger

// 全局设置（应用到默认 logger）
function setLevel(level: LogLevel, logger?: Logger): void
function setFormatter(formatter: LogFormatter, logger?: Logger): void
function addTransport(transport: LogTransport, logger?: Logger): void
function removeTransport(transport: LogTransport, logger?: Logger): void
function setOptions(options: LoggerOptions, logger?: Logger): void
function getLoggerNames(logger?: Logger): string[]

// 便捷日志方法（使用默认 logger）
function debug(message: string, ...args: any[]): void
function info(message: string, ...args: any[]): void
function success(message: string, ...args: any[]): void
function warn(message: string, ...args: any[]): void
function error(message: string, ...args: any[]): void
function time(label: string): Timer
function timeEnd(label: string): void
```

## 🔧 在 Zhin 插件中使用

```typescript
import { Plugin } from 'zhin.js'
import { getLogger } from '@zhin.js/logger'

export default class MyPlugin extends Plugin {
  private logger = getLogger(`Plugin:${this.name}`)

  async onMounted() {
    this.logger.success('插件加载成功')
    
    this.logger.info('插件配置: %o', this.config)

    // 创建子模块 Logger
    const dbLogger = this.logger.getLogger('Database')
    const apiLogger = this.logger.getLogger('API')
    
    dbLogger.info('数据库模块初始化')
    apiLogger.info('API模块初始化')
  }

  async handleMessage(message: Message) {
    // 为每个消息创建独立的处理 Logger
    const msgLogger = this.logger.getLogger('MessageHandler')
    const timer = msgLogger.time('消息处理')
    
    try {
      msgLogger.debug('收到消息: %s', message.content)
      
      // 使用不同子 Logger 处理不同逻辑
      const validatorLogger = msgLogger.getLogger('Validator')
      const processorLogger = msgLogger.getLogger('Processor')
      
      validatorLogger.debug('开始验证消息')
      processorLogger.debug('开始处理消息')
      
      await this.processMessage(message)
      
      msgLogger.success('消息处理完成')
      
    } catch (error) {
      msgLogger.error('消息处理失败: %s', error.message)
      throw error
      
    } finally {
      timer.end()
    }
  }
}
```

## 🎯 设计特点

### 轻量级依赖
- 仅依赖 `chalk` 用于颜色输出
- 无其他第三方库，包体积小
- 启动速度快，内存占用低

### 自管理架构（核心特色）
- **层次化管理**: 每个 Logger 自管理其子 Logger
- **getLogger 方法**: 直观的子 Logger 获取方式
- **配置继承**: 子 Logger 自动继承父级配置
- **配置覆盖**: 支持在创建时覆盖特定配置
- **递归操作**: 支持递归设置级别、格式化器、输出器
- **父子关系**: 完整的父子关系查询和管理

### 智能着色系统
- **级别颜色**: 固定的颜色方案，一目了然
- **名称颜色**: 自动分配，相同名称始终相同颜色
- **文件输出**: 自动去除颜色代码

### 高性能设计
- 使用原生 `performance.now()` 进行高精度计时
- 级别检查避免不必要的字符串处理
- 最小化内存分配和垃圾回收
- 缓存子 Logger 实例，避免重复创建

## 🆚 对比优势

| 特性 | @zhin.js/logger | pino | winston |
|------|----------------|------|---------|
| 包大小 | < 50KB | > 500KB | > 1MB |
| 依赖数量 | 1 | 10+ | 20+ |
| 启动时间 | 极快 | 快 | 中等 |
| 自定义格式 | ✅ 简单 | ⚠️ 复杂 | ⚠️ 复杂 |
| 颜色输出 | ✅ 内置 | ❌ 需插件 | ❌ 需插件 |
| 子Logger管理 | ✅ **自管理** | ⚠️ 全局管理 | ⚠️ 全局管理 |
| 配置继承 | ✅ **自动继承** | ❌ 手动配置 | ❌ 手动配置 |
| 递归操作 | ✅ **内置支持** | ❌ 不支持 | ❌ 不支持 |
| TypeScript | ✅ 原生 | ✅ 支持 | ✅ 支持 |

## 📄 许可证

MIT

---

一个专为 Zhin Endpoint Framework 设计的轻量级、高性能日志库。🚀