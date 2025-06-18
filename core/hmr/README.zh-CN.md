# JSX 热模块替换 (HMR) 系统

[English](README.md) | [中文](README.zh-CN)

一个强大而灵活的 Node.js 热模块替换系统，提供高效的模块重载和依赖管理功能。

## 特性

- 🔄 **智能文件变化检测**
    - 使用 mtime 和 hash 的双重检测机制
    - 针对大小文件分别优化
    - 可配置的文件扩展名监听

- 🏗️ **高级依赖管理**
    - 自动依赖解析
    - 循环依赖检测
    - 版本兼容性检查
    - 插件生命周期管理

- 🎯 **上下文系统**
    - React Hooks 风格的上下文管理
    - 依赖注入支持
    - 自动上下文传播

- 📊 **性能监控**
    - 详细的重载统计
    - 性能指标追踪
    - 调试模式支持

- 🔧 **灵活配置**
    - 可自定义监听选项
    - 可扩展的日志系统
    - 可配置的防抖时间

## 安装

```bash
npm install @your-org/hmr
```

## 快速开始

```typescript
import { HMR } from '@your-org/hmr';

// 创建自定义 HMR 实现
class MyHMR extends HMR {
  createDependency(name: string, filePath: string) {
    // 实现依赖创建逻辑
    return new MyDependency(this, name, filePath);
  }
}

// 初始化 HMR
const hmr = new MyHMR('my-app', __filename, {
  dirs: ['./src'],
  extensions: new Set(['.ts', '.js', '.json']),
  debug: true
});

// 开始监听
hmr.on('change', (dependency) => {
  console.log(`模块已更改: ${dependency.name}`);
});
```

## 配置选项

```typescript
interface HMRConfig {
  enabled?: boolean;          // 是否启用
  priority?: number;          // 优先级
  disable_dependencies?: string[];  // 禁用的依赖
  extensions?: Set<string>;   // 监听的文件扩展名
  dirs?: string[];           // 监听的目录
  max_listeners?: number;    // 最大监听器数量
  debounce?: number;         // 防抖时间（毫秒）
  algorithm?: string;        // 哈希算法
  debug?: boolean;           // 调试模式
  logger?: Logger;           // 日志记录器
}
```

## API 参考

### 核心方法

- `createDependency(name: string, filePath: string): P` - 创建依赖实例的抽象方法
- `dispose(): void` - 清理资源并停止监听
- `getConfig(): Readonly<HMRConfig>` - 获取当前配置
- `updateHMRConfig(config: Partial<HMRConfig>): void` - 更新配置

### 目录管理

- `addWatchDir(dir: string): boolean` - 添加监听目录
- `removeWatchDir(dir: string): boolean` - 移除监听目录
- `updateWatchDirs(dirs: string[]): void` - 更新监听目录列表
- `getWatchDirs(): ReadonlyArray<string>` - 获取当前监听目录

### 性能监控

- `getPerformanceStats()` - 获取性能统计信息
- `resetPerformanceStats(): void` - 重置性能指标
- `setDebugMode(enabled: boolean): void` - 切换调试模式

### 事件

- `add` - 添加新依赖时触发
- `remove` - 移除依赖时触发
- `change` - 依赖发生变化时触发
- `error` - 发生错误时触发
- `dispose` - 系统销毁时触发
- `config-changed` - 配置更改时触发

## 高级用法

### 自定义日志记录器

```typescript
import { Logger } from '@your-org/hmr';

class CustomLogger implements Logger {
  debug(message: string, ...args: unknown[]): void {
    // 实现调试日志
  }
  info(message: string, ...args: unknown[]): void {
    // 实现信息日志
  }
  warn(message: string, ...args: unknown[]): void {
    // 实现警告日志
  }
  error(message: string, ...args: unknown[]): void {
    // 实现错误日志
  }
}

const hmr = new MyHMR('my-app', __filename, {
  logger: new CustomLogger()
});
```

### 上下文管理

```typescript
// 创建上下文
hmr.createContext({
  name: 'myContext',
  mounted: (parent) => {
    // 初始化上下文值
    return someValue;
  },
  dispose: (value) => {
    // 清理上下文值
  }
});

// 在依赖中使用上下文
const context = dependency.useContext('myContext');
```

## 性能考虑

- 系统使用智能文件变化检测机制，结合 mtime 和 hash 检查
- 对于小文件（< 1MB），仅使用 mtime 进行变化检测
- 对于大文件，使用基于 hash 的检测
- 可配置的防抖时间防止过度重载
- 可配置的事件监听器限制防止内存泄漏

## 贡献

欢迎贡献代码！请随时提交 Pull Request。

## 许可证

MIT 许可证 - 详见 LICENSE 文件 