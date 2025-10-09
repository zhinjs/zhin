# @zhin.js/hmr

企业级热模块替换 (HMR) 系统，为 Zhin 框架提供高性能的模块热重载能力。采用模块化架构设计，支持复杂的依赖关系管理和上下文系统。

## 核心特性

- 🔥 **热模块替换**: 代码修改即时生效，无需重启
- 📊 **性能监控**: 详细的重载时间统计和性能分析
- 🎯 **依赖管理**: 完整的依赖树管理和生命周期控制
- 🔍 **智能监听**: 基于文件扩展名的智能文件监听
- 🧩 **上下文系统**: 强大的依赖注入和上下文管理
- ⚡ **高性能**: 优化的重载算法和防抖机制
- 🛠️ **可扩展**: 模块化设计，易于扩展和定制

## 架构组件

### Dependency 类 - 依赖基类

所有可热重载组件的基础类，提供完整的生命周期管理：

```typescript
import { Dependency } from '@zhin.js/hmr'

class MyComponent extends Dependency {
  constructor(parent: Dependency, name: string, filePath: string) {
    super(parent, name, filePath)
  }
  
  // 生命周期回调
  async mounted() {
    console.log('组件已挂载')
  }
  
  dispose() {
    console.log('组件正在销毁')
    super.dispose()
  }
}
```

**主要功能：**
- 📋 生命周期管理 (`waiting` → `ready` → `disposed`)
- 🌳 依赖树结构维护
- 📡 事件系统和广播机制
- 🔧 上下文注册和依赖注入
- ⚙️ 配置管理和热更新

### HMR 类 - 热更新核心

抽象基类，继承自 `Dependency`，组合各个功能模块：

```typescript
import { HMR } from '@zhin.js/hmr'

class MyHMRSystem extends HMR<MyComponent> {
  // 抽象方法：创建依赖实例
  createDependency(name: string, filePath: string): MyComponent {
    return new MyComponent(this, name, filePath)
  }
}

const hmr = new MyHMRSystem('MySystem', {
  dirs: ['./src', './plugins'],
  extensions: new Set(['.js', '.ts', '.jsx', '.tsx']),
  debug: process.env.NODE_ENV === 'development',
  debounce: 100,
  max_listeners: 50
})
```

**内部组件：**
- 🔍 `FileWatcher` - 文件系统监听
- 📦 `ModuleLoader` - 模块加载和缓存
- 📊 `PerformanceMonitor` - 性能监控统计
- 🔄 `ReloadManager` - 重载调度管理

### FileWatcher - 文件监听器

高性能文件系统监听器，支持递归目录监听：

```typescript
const watcher = new FileWatcher(
  ['./src', './plugins'],           // 监听目录
  ['.js', '.ts', '.vue'],          // 监听扩展名
  logger,                          // 日志记录器
  ['node_modules']                 // 排除目录
)

watcher.on('file-change', (filePath, eventType) => {
  console.log(`文件 ${filePath} 发生 ${eventType} 事件`)
})

// 动态添加监听目录
watcher.addWatchDir('./new-plugin')
```

**特性：**
- 🚀 支持 Node.js 和 Bun 运行时
- 📁 递归目录监听
- 🎯 智能文件过滤
- 🔧 动态目录管理

### ModuleLoader - 模块加载器

智能模块加载器，支持缓存和哈希验证：

```typescript
const loader = new ModuleLoader(hmrInstance, logger, 'md5')

// 加载模块
const dependency = await loader.add('my-plugin', './plugins/my-plugin.ts')

// 重载模块
await loader.reload('./plugins/my-plugin.ts')

// 检查文件变化
const hasChanged = loader.hasFileChanged('./plugins/my-plugin.ts')
```

**功能：**
- 🔐 文件哈希校验 (支持 md5, sha1, sha256)
- 💾 智能模块缓存
- 🔄 异步模块加载
- 🧹 自动缓存清理

### PerformanceMonitor - 性能监控

详细的性能统计和监控工具：

```typescript
const monitor = new PerformanceMonitor()

// 创建计时器
const timer = monitor.createTimer()
await performSomeWork()
const duration = timer.stop()

// 记录重载时间
monitor.recordReloadTime(duration)

// 记录错误
monitor.recordError()

// 获取性能报告
console.log(monitor.getReport())
```

**统计信息：**
- ⏱️ 重载时间统计 (平均/最小/最大)
- 📈 重载次数计数
- ❌ 错误次数统计
- 📊 性能趋势分析

### ReloadManager - 重载管理器

智能重载调度器，支持防抖和错误恢复：

```typescript
const reloadManager = new ReloadManager(logger, 300) // 300ms 防抖

reloadManager.on('reload-file', async (filePath) => {
  await handleFileReload(filePath)
})

// 调度重载
reloadManager.scheduleReload('./changed-file.ts')
```

**特性：**
- 🕐 重载防抖机制
- 📋 重载队列管理
- 🛠️ 错误恢复策略
- 📊 状态监控

## 上下文系统

强大的依赖注入系统，支持异步上下文管理：

```typescript
// 注册上下文
dependency.register({
  name: 'database',
  async mounted(dependency) {
    const db = new Database()
    await db.connect()
    return db
  },
  async dispose(db) {
    await db.disconnect()
  }
})

// 使用上下文依赖
dependency.useContext('database', 'config', async (db, config) => {
  const users = await db.query('SELECT * FROM users')
  console.log(`加载了 ${users.length} 个用户`)
  
  // 返回清理函数（可选）
  return async (context) => {
    console.log('上下文清理中...')
  }
})
```

## 完整使用示例

### 创建自定义 HMR 系统

```typescript
import { HMR, Dependency } from '@zhin.js/hmr'

// 定义组件类
class PluginComponent extends Dependency {
  private handler?: Function
  
  constructor(parent: Dependency, name: string, filePath: string) {
    super(parent, name, filePath)
  }
  
  async mounted() {
    try {
      // 动态导入模块
      const module = await import(this.filename + '?t=' + Date.now())
      this.handler = module.default || module
      
      console.log(`插件 ${this.name} 已加载`)
    } catch (error) {
      console.error(`插件 ${this.name} 加载失败:`, error)
    }
  }
  
  execute(...args: any[]) {
    return this.handler?.(...args)
  }
  
  dispose() {
    this.handler = undefined
    super.dispose()
  }
}

// 创建 HMR 系统
class PluginHMR extends HMR<PluginComponent> {
  createDependency(name: string, filePath: string): PluginComponent {
    return new PluginComponent(this, name, filePath)
  }
}

// 初始化系统
const pluginSystem = new PluginHMR('PluginSystem', {
  dirs: ['./plugins'],
  extensions: new Set(['.js', '.ts']),
  debug: true,
  debounce: 200,
  algorithm: 'sha256'
})

// 事件监听
pluginSystem.on('add', (plugin: PluginComponent) => {
  console.log(`新插件: ${plugin.name}`)
})

pluginSystem.on('reload', (filePath: string) => {
  console.log(`文件重载: ${filePath}`)
})

pluginSystem.on('error', (error: Error) => {
  console.error('系统错误:', error)
})

// 启动系统
await pluginSystem.waitForReady()
console.log('插件系统已就绪')
```

### 高级配置

```typescript
// 环境感知配置
const hmrOptions: HMROptions = {
  dirs: process.env.NODE_ENV === 'development' 
    ? ['./src', './plugins', './dev-plugins'] 
    : ['./plugins'],
    
  extensions: new Set(['.js', '.ts', '.jsx', '.tsx', '.vue']),
  
  debug: process.env.DEBUG === 'true',
  
  // 根据系统性能调整
  debounce: process.env.NODE_ENV === 'production' ? 500 : 100,
  
  max_listeners: parseInt(process.env.MAX_LISTENERS || '30'),
  
  // 使用更安全的哈希算法
  algorithm: 'sha256',
  
  // 自定义日志记录器
  logger: new CustomLogger('[HMR]', {
    level: process.env.LOG_LEVEL || 'info'
  })
}
```

## 性能优化

### 监听目录优化

```typescript
// 避免监听大型目录
const optimizedDirs = [
  './src',
  './plugins',
  // ❌ 避免: './node_modules' (太大)
  // ❌ 避免: './' (根目录，文件太多)
]

// 使用精确的文件扩展名
const optimizedExtensions = new Set([
  '.js', '.ts',    // 只监听需要的文件类型
  // ❌ 避免: '*' (匹配所有文件)
])
```

### 性能监控示例

```typescript
// 定期输出性能报告
setInterval(() => {
  const stats = hmr.getPerformanceStats()
  console.log(`
📊 性能统计:
  - 重载次数: ${stats.reloadCount}
  - 平均重载时间: ${stats.averageReloadTime}ms
  - 错误次数: ${stats.errorCount}
  - 内存使用: ${process.memoryUsage().heapUsed / 1024 / 1024}MB
  `)
}, 30000) // 每30秒输出一次
```

## 事件系统

### 核心事件

```typescript
hmr.on('add', (dependency) => {
  console.log(`依赖已添加: ${dependency.name}`)
})

hmr.on('remove', (dependency) => {
  console.log(`依赖已移除: ${dependency.name}`)
})

hmr.on('reload', (filePath) => {
  console.log(`文件已重载: ${filePath}`)
})

hmr.on('error', (error) => {
  console.error(`系统错误:`, error)
})

hmr.on('file-change', (filePath, eventType) => {
  console.log(`文件变化: ${filePath} (${eventType})`)
})
```

### 生命周期事件

```typescript
dependency.on('self.mounted', (dep) => {
  console.log(`${dep.name} 已挂载`)
})

dependency.on('self.dispose', (dep) => {
  console.log(`${dep.name} 已销毁`)
})

dependency.on('lifecycle-changed', (oldState, newState) => {
  console.log(`状态变更: ${oldState} → ${newState}`)
})
```

## API 参考

### HMROptions 接口

```typescript
interface HMROptions extends DependencyOptions {
  /** 监听目录列表 */
  dirs?: string[]
  
  /** 监听的文件扩展名 */
  extensions?: Set<string> | string[]
  
  /** 日志记录器 */
  logger?: Logger
  
  /** 最大事件监听器数量 */
  max_listeners?: number
  
  /** 重载防抖时间（毫秒） */
  debounce?: number
  
  /** 文件哈希算法 */
  algorithm?: 'md5' | 'sha1' | 'sha256'
  
  /** 调试模式 */
  debug?: boolean
}
```

### 静态方法

```typescript
// 获取当前活动的 HMR 实例
const currentHMR = HMR.currentHMR

// 获取当前活动的依赖
const currentDependency = HMR.currentDependency

// 获取调用者文件路径
const callerFile = HMR.getCurrentFile()

// 获取调用栈
const callStack = HMR.getCurrentStack()
```

## 故障排查

### 常见问题

1. **文件监听不工作**
   ```typescript
   // 检查文件扩展名配置
   const extensions = hmr.options.extensions
   console.log('监听的扩展名:', Array.from(extensions))
   
   // 检查监听目录
   console.log('监听目录:', hmr.getWatchDirs())
   ```

2. **重载性能问题**
   ```typescript
   // 查看性能统计
   console.log(hmr.getPerformanceReport())
   
   // 调整防抖时间
   hmr.updateOptions({ debounce: 500 })
   ```

3. **内存泄漏**
   ```typescript
   // 定期清理
   setInterval(() => {
     hmr.performGC()
   }, 60000)
   
   // 检查事件监听器
   console.log('监听器数量:', hmr.listenerCount('reload'))
   ```

## 最佳实践

1. **合理设置防抖时间**: 开发环境 100-200ms，生产环境 300-500ms
2. **精确配置文件扩展名**: 只监听必要的文件类型
3. **避免监听大型目录**: 如 `node_modules`，会严重影响性能
4. **及时清理事件监听器**: 防止内存泄漏
5. **使用性能监控**: 定期检查重载性能
6. **错误处理**: 为所有异步操作添加错误处理

## 依赖项

- `@zhin.js/types` - TypeScript 类型定义
- Node.js 内置模块：`fs`, `path`, `events`, `crypto`

## 许可证

MIT License