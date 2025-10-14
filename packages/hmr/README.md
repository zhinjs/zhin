# @zhin.js/hmr

Zhin 机器人框架的热模块替换（Hot Module Replacement）系统，提供文件监听、模块加载、依赖管理和性能监控。

## 特性

- 🔥 **热重载** - 文件变更自动重新加载模块
- 📦 **模块加载器** - 智能的 ES 模块加载和缓存
- 🎯 **依赖管理** - 完整的依赖树管理和生命周期
- 📊 **性能监控** - 内置性能监控和计时器
- 🔍 **文件监听** - 高效的文件变更监听
- 🔄 **重载管理** - 智能的模块重载策略
- 🛡️ **错误处理** - 完善的错误恢复机制
- 🎨 **上下文系统** - 灵活的上下文注册和依赖注入

## 安装

```bash
pnpm add @zhin.js/hmr
```

`@zhin.js/hmr` 已内置在 `@zhin.js/core` 中，通常不需要单独安装。

## 核心类

### HMR

HMR 基类，提供热模块替换功能。

```typescript
import { HMR } from '@zhin.js/hmr'

class MyHMR extends HMR<MyDependency> {
  createDependency(name: string, filePath: string): MyDependency {
    return new MyDependency(this, name, filePath)
  }
}

const hmr = new MyHMR('MyApp', {
  dirs: ['./plugins'],
  extensions: new Set(['.js', '.ts']),
  debug: false
})

await hmr.start()
```

**主要方法：**

- `hmr.start()` - 启动 HMR
- `hmr.stop()` - 停止 HMR
- `hmr.reload(filename)` - 重载指定文件
- `hmr.dispose()` - 销毁 HMR
- `hmr.addWatchDir(dir)` - 添加监听目录
- `hmr.removeWatchDir(dir)` - 移除监听目录
- `hmr.waitForReady()` - 等待所有依赖就绪

**属性：**

- `hmr.isReady` - 是否就绪
- `hmr.dependencyList` - 依赖列表
- `HMR.currentHMR` - 当前活动的 HMR 实例
- `HMR.currentDependency` - 当前活动的依赖

### Dependency

依赖基类，提供事件系统和依赖层次结构管理。

```typescript
import { Dependency } from '@zhin.js/hmr'

class MyDependency extends Dependency {
  constructor(parent: Dependency | null, name: string, filename: string) {
    super(parent, name, filename, {
      enabled: true,
      priority: 0
    })
  }
}

// 使用
const dep = new MyDependency(null, 'my-dep', './dep.js')

// 监听事件
dep.on('mounted', () => {
  console.log('依赖已挂载')
})

dep.on('dispose', () => {
  console.log('依赖已销毁')
})

// 注册上下文
dep.register({
  name: 'myService',
  async mounted(dep) {
    return new MyService()
  },
  dispose() {
    // 清理
  }
})

// 使用上下文
dep.useContext(['myService'], (myService) => {
  // 使用服务
  return (context) => {
    // 清理函数
  }
})
```

**主要方法：**

- `dep.register(context)` - 注册上下文
- `dep.useContext(contexts, sideEffect)` - 使用上下文
- `dep.before(event, listener)` - 前置事件监听
- `dep.dispatch(event, ...args)` - 派发事件
- `dep.mounted()` - 挂载依赖
- `dep.dispose()` - 销毁依赖
- `dep.findChild(filename)` - 查找子依赖
- `dep.findPluginByName(name)` - 按名称查找插件
- `dep.waitForReady()` - 等待依赖就绪

**属性：**

- `dep.parent` - 父依赖
- `dep.name` - 依赖名称
- `dep.filename` - 文件路径
- `dep.contexts` - 上下文映射
- `dep.dependencies` - 子依赖映射
- `dep.isReady` - 是否就绪
- `dep.isDispose` - 是否已销毁
- `dep.options` - 依赖配置

### FileWatcher

文件监听器，监听文件变更。

```typescript
import { FileWatcher } from '@zhin.js/hmr'

const watcher = new FileWatcher(['./src'], {
  extensions: new Set(['.js', '.ts']),
  ignored: /node_modules/
})

watcher.on('change', (filename) => {
  console.log('文件变更:', filename)
})

watcher.on('unlink', (filename) => {
  console.log('文件删除:', filename)
})

watcher.start()
```

### ModuleLoader

模块加载器，负责加载和缓存 ES 模块。

```typescript
import { ModuleLoader } from '@zhin.js/hmr'

const loader = new ModuleLoader()

// 加载模块
const module = await loader.load('./plugin.js')

// 卸载模块
await loader.unload('./plugin.js')

// 重新加载
const newModule = await loader.reload('./plugin.js')

// 获取缓存的模块
const cached = loader.getModule('./plugin.js')

// 清除所有缓存
loader.clearCache()
```

### PerformanceMonitor

性能监控器，监控模块加载和重载性能。

```typescript
import { PerformanceMonitor, Timer } from '@zhin.js/hmr'

const monitor = new PerformanceMonitor()

// 开始计时
const timer = monitor.start('load-plugin')

// ... 执行操作

// 结束计时
const duration = timer.end()
console.log('耗时:', duration, 'ms')

// 获取统计信息
const stats = monitor.getStats('load-plugin')
console.log('平均耗时:', stats.average, 'ms')
console.log('最大耗时:', stats.max, 'ms')
console.log('最小耗时:', stats.min, 'ms')
```

### ReloadManager

重载管理器，管理模块重载策略。

```typescript
import { ReloadManager } from '@zhin.js/hmr'

const manager = new ReloadManager({
  debounce: 100,
  maxRetries: 3
})

manager.on('reload-start', (filename) => {
  console.log('开始重载:', filename)
})

manager.on('reload-end', (filename, duration) => {
  console.log('重载完成:', filename, duration, 'ms')
})

manager.on('reload-error', (filename, error) => {
  console.error('重载失败:', filename, error)
})

await manager.reload('./plugin.js')
```

## 上下文系统

### 注册上下文

```typescript
import { Dependency } from '@zhin.js/hmr'

const dep = new Dependency(null, 'my-dep', './dep.js')

// 注册上下文
dep.register({
  name: 'http',
  description: 'HTTP 服务',
  async mounted(dep) {
    const server = new HttpServer()
    await server.start()
    return server
  },
  async dispose() {
    await server.stop()
  }
})
```

### 使用上下文

```typescript
// 单个上下文
dep.useContext(['http'], (http) => {
  // 使用 HTTP 服务
  http.get('/api', handler)
  
  // 返回清理函数
  return (http) => {
    // 清理
  }
})

// 多个上下文
dep.useContext(['http', 'database'], (http, database) => {
  // 使用多个服务
  
  return (context) => {
    // 清理
  }
})
```

### 检查上下文就绪

```typescript
// 检查上下文是否就绪
if (dep.contextIsReady('http')) {
  const http = dep.getContextValue('http')
  // 使用服务
}
```

## 生命周期

### 依赖生命周期

```typescript
const dep = new Dependency(null, 'my-dep', './dep.js')

// 等待状态
console.log(dep.getLifecycleState()) // 'waiting'

// 挂载
dep.on('self.mounted', () => {
  console.log('自身已挂载')
})

dep.on('mounted', () => {
  console.log('依赖已挂载')
})

dep.mounted()
console.log(dep.isReady) // true

// 销毁
dep.on('self.dispose', () => {
  console.log('自身正在销毁')
})

dep.on('dispose', () => {
  console.log('依赖已销毁')
})

dep.dispose()
console.log(dep.isDispose) // true
```

### 上下文生命周期

```typescript
dep.on('context.mounted', (name) => {
  console.log('上下文已挂载:', name)
})

dep.on('context.dispose', (name) => {
  console.log('上下文已销毁:', name)
})
```

## 事件系统

### 前置事件

```typescript
// 注册前置事件监听器
dep.before('message.send', (options) => {
  console.log('消息发送前:', options)
  // 可以修改 options
  return modifiedOptions
})

// 触发事件（会先触发前置事件）
await dep.dispatch('message.send', options)
```

### 事件监听

```typescript
// 监听事件
dep.on('custom-event', (data) => {
  console.log('自定义事件:', data)
})

// 监听一次
dep.once('custom-event', (data) => {
  console.log('只触发一次')
})

// 移除监听
const handler = (data) => {}
dep.on('custom-event', handler)
dep.off('custom-event', handler)

// 派发事件
dep.dispatch('custom-event', { data: 'value' })
```

## 工具函数

### getCallerFile

获取调用者的文件路径。

```typescript
import { getCallerFile } from '@zhin.js/hmr'

const callerFile = getCallerFile(import.meta.url)
console.log('调用文件:', callerFile)
```

### getCallerFiles

获取调用堆栈中的所有文件路径。

```typescript
import { getCallerFiles } from '@zhin.js/hmr'

const callerFiles = getCallerFiles(import.meta.url)
console.log('调用堆栈:', callerFiles)
```

### Context 类型

定义上下文。

```typescript
import { Context } from '@zhin.js/hmr'

const httpContext: Context = {
  name: 'http',
  description: 'HTTP 服务',
  async mounted(dep) {
    return new HttpServer()
  },
  async dispose() {
    // 清理
  }
}
```

### Logger

获取日志器。

```typescript
import { Logger } from '@zhin.js/hmr'

const logger = dep.getLogger('MyPlugin')

logger.debug('调试信息')
logger.info('普通信息')
logger.warn('警告信息')
logger.error('错误信息')
```

## 配置选项

### HMROptions

```typescript
interface HMROptions {
  // 优先级
  priority?: number
  
  // 监听目录
  dirs?: string[]
  
  // 是否启用
  enabled?: boolean
  
  // 监听的文件扩展名
  extensions?: Set<string>
  
  // 最大监听器数量
  max_listeners?: number
  
  // 防抖延迟
  debounce?: number
  
  // 哈希算法
  algorithm?: string
  
  // 是否调试模式
  debug?: boolean
  
  // 版本
  version?: string
  
  // 日志器
  logger?: Logger
}
```

### DependencyOptions

```typescript
interface DependencyOptions {
  // 是否启用
  enabled?: boolean
  
  // 优先级
  priority?: number
}
```

## 完整示例

### 基础 HMR 应用

```typescript
import { HMR, Dependency } from '@zhin.js/hmr'

class Plugin extends Dependency {
  constructor(parent: Dependency, name: string, filename: string) {
    super(parent, name, filename)
    
    // 监听挂载
    this.on('mounted', () => {
      console.log(`插件 ${name} 已加载`)
    })
    
    // 监听销毁
    this.on('dispose', () => {
      console.log(`插件 ${name} 已卸载`)
    })
  }
}

class App extends HMR<Plugin> {
  createDependency(name: string, filename: string): Plugin {
    return new Plugin(this, name, filename)
  }
}

const app = new App('MyApp', {
  dirs: ['./plugins'],
  extensions: new Set(['.js', '.ts'])
})

await app.start()
```

### 使用上下文

```typescript
class Plugin extends Dependency {
  constructor(parent: Dependency, name: string, filename: string) {
    super(parent, name, filename)
    
    // 注册上下文
    this.register({
      name: 'database',
      async mounted(dep) {
        const db = new Database()
        await db.connect()
        return db
      },
      async dispose() {
        await db.disconnect()
      }
    })
    
    // 使用上下文
    this.useContext(['http'], (http) => {
      http.get('/api', handler)
      
      return (http) => {
        // 清理
      }
    })
  }
}
```

### 性能监控

```typescript
import { PerformanceMonitor } from '@zhin.js/hmr'

const monitor = new PerformanceMonitor()

class App extends HMR<Plugin> {
  async reload(filename: string) {
    const timer = monitor.start(`reload:${filename}`)
    
    try {
      await super.reload(filename)
    } finally {
      const duration = timer.end()
      console.log(`重载 ${filename} 耗时: ${duration}ms`)
    }
  }
}
```

## 最佳实践

### 1. 正确清理资源

```typescript
class Plugin extends Dependency {
  private timers: NodeJS.Timeout[] = []
  
  constructor(parent: Dependency, name: string, filename: string) {
    super(parent, name, filename)
    
    // 添加定时器
    const timer = setInterval(() => {}, 1000)
    this.timers.push(timer)
    
    // 清理资源
    this.on('dispose', () => {
      this.timers.forEach(t => clearInterval(t))
      this.timers = []
    })
  }
}
```

### 2. 使用依赖配置

```typescript
const plugin = new Plugin(parent, 'my-plugin', './plugin.js', {
  enabled: true,
  priority: 10
})

// 更新配置
plugin.updateOptions({ enabled: false })
```

### 3. 等待就绪

```typescript
// 等待依赖就绪
await plugin.waitForReady()

// 等待所有依赖就绪
await app.waitForReady()
```

## 相关资源

- [完整文档](https://docs.zhin.dev)
- [HMR 指南](https://docs.zhin.dev/guide/hmr)
- [API 参考](https://docs.zhin.dev/api/hmr)

## 许可证

MIT License


