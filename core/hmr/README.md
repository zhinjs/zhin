# HMR (Hot Module Replacement)

一个强大的TypeScript热模块替换系统，支持插件化架构和上下文管理。

## 特性

- 🔥 实时热重载：文件变更时自动重新加载模块
- 🎯 插件系统：支持动态加载和管理插件
- 🔄 上下文管理：类似React的Context系统，支持依赖注入
- 🛡️ 生命周期管理：完整的插件生命周期（初始化、就绪、销毁）
- 📦 模块解析：智能的模块解析系统，支持多种文件扩展名
- 🔍 文件监听：高性能的文件系统监听，支持多目录
- 🎨 事件系统：基于EventEmitter的事件驱动架构
- 📊 性能监控：内置性能统计和监控功能
- 🔧 可配置：丰富的配置选项，支持自定义扩展

## 安装

```bash
npm install @your-scope/hmr
```

## 快速开始

1. 创建应用实例：

```typescript
import { App } from '@your-scope/hmr';
import path from 'path';

const app = new App({
    plugin_dirs: [path.join(__dirname, 'plugins')],
    plugins: ['demo-plugin']
});

app.start();
```

2. 创建插件：

```typescript
import { onInit, createContext, onDispose } from '@your-scope/hmr';

// 创建Context
createContext({
    name: 'database',
    async onInit() {
        const db = new Database();
        await db.connect();
        return db;
    },
    dispose(db) {
        db.dispose();
    }
});

// 初始化钩子
onInit(async (plugin) => {
    const db = plugin.useContext('database').value;
    // 使用数据库...
});

// 清理钩子
onDispose(() => {
    console.log('Plugin disposed');
});
```

## 核心概念

### Context系统

Context系统允许插件之间共享状态和功能：

```typescript
// 创建Context
createContext({
    name: 'cache',
    onInit() {
        return new Cache();
    },
    dispose(cache) {
        cache.clear();
    }
});

// 使用Context
const cache = useContext('cache').value;
```

### 事件系统

支持丰富的事件处理：

```typescript
// 监听消息
onGroupMessage((message) => {
    console.log('Group message:', message);
});

onPrivateMessage((message) => {
    console.log('Private message:', message);
});

// 注册命令
addCommand('test', () => {
    console.log('Command executed');
});
```

### 配置选项

```typescript
interface HMRConfig {
    // 可监听的文件扩展名
    extensions?: Set<string>;
    // 要监听的目录列表
    dirs?: string[];
    // 最大事件监听器数量
    max_listeners?: number;
    // 重载防抖时间（毫秒）
    debounce?: number;
    // 哈希算法
    algorithm?: string;
    // 是否启用调试模式
    debug?: boolean;
    // 自定义日志记录器
    logger?: Logger;
}
```

## 高级用法

### 自定义依赖类

```typescript
export class Plugin extends Dependency<Plugin> {
    commands = new Map<string, () => void>();
    
    constructor(app: App, name: string, filePath: string) {
        super(app, name, filePath);
    }
}
```

### 性能监控

```typescript
const stats = app.getPerformanceStats();
console.log('Performance stats:', stats);
```

### 调试模式

```typescript
app.setDebugMode(true);
```

## 最佳实践

1. 使用Context进行依赖注入，避免直接依赖
2. 在onInit中初始化资源，在onDispose中清理资源
3. 使用事件系统进行插件间通信
4. 合理设置防抖时间，避免频繁重载
5. 使用TypeScript类型系统确保类型安全

## 贡献

欢迎提交Issue和Pull Request！

## 许可证

MIT

## 调试工具

HMR系统提供了一个强大的调试工具，可以帮助你监控和诊断热更新过程中的问题。

### 基本用法

```typescript
import { HMR } from '@zhinjs/hmr';
import * as path from 'path';

// 创建HMR实例
const hmr = new HMR({
    rootDir: path.join(__dirname, 'plugins'),
    watchOptions: {
        ignored: /node_modules/,
        persistent: true
    }
});

// 创建调试器实例
const debuggerInstance = new HMRDebugger(hmr, 'logs');

// 加载插件
await hmr.loadPlugin('path/to/plugin.ts');

// 生成调试报告
debuggerInstance.generateReport('debug-report.html');
```

### 功能特性

1. **实时监控**
    - 插件加载状态
    - 热更新事件
    - 错误追踪
    - 性能指标

2. **日志记录**
    - 自动记录所有HMR相关事件
    - 支持不同级别的日志（info, error, warn, debug）
    - 日志文件自动轮转

3. **性能统计**
    - 总重载次数
    - 平均重载时间
    - 错误计数
    - 依赖关系图

4. **HTML报告**
    - 可视化展示性能指标
    - 依赖状态表格
    - 错误详情
    - 实时更新

### 示例

查看 `example/debug-example.ts` 获取完整的使用示例。 