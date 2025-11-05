# 🌲 @zhin.js/dependency

一个强大的依赖树分析工具，支持动态导入、热重载、生命周期管理和可扩展的 Hook 系统。

## 📋 目录

- [主要特性](#-主要特性)
- [安装](#-安装)
- [快速开始](#-快速开始)
  - [基本用法](#基本用法)
  - [在插件中使用 Hooks](#在插件中使用-hooks)
  - [继承 Dependency 类](#继承-dependency-类)
- [配置](#-配置)
  - [环境变量](#环境变量)
  - [运行时配置](#运行时配置)
- [副作用自动管理](#-副作用自动管理)
- [可扩展 Hook 系统](#-可扩展-hook-系统)
- [热重载](#-热重载)
- [类继承指南](#-类继承指南)
- [插件生态系统](#-插件生态系统)
- [API 文档](#-api-文档)
- [生命周期](#-生命周期)

## ✨ 主要特性

- 🌲 **依赖树构建** - 自动构建模块依赖关系树
- 🔄 **热重载支持** - 文件变更时自动重载，保留子依赖树
- 🎯 **原生 import 支持** - 使用标准 ES 模块语法，无需自定义函数
- 🪝 **可扩展 Hook 系统** - 注册自定义 hooks，支持自动类型推断
- 🧹 **副作用自动管理** - 自动包装 `setInterval`、`setTimeout` 等副作用函数，自动清理
- 📦 **跨运行时支持** - Node.js / tsx / Bun
- 🎨 **生命周期管理** - `start`, `mount`, `dispose`, `stop` 生命周期方法
- 🔔 **EventEmitter 集成** - 标准的事件系统
- 🎯 **TypeScript 类型支持** - 完整的类型定义和类型推断
- 🧬 **继承支持** - 完全支持类继承，创建自定义插件类

## 📦 安装

```bash
pnpm add @zhin.js/dependency
```

## 🚀 快速开始

> 💡 **完整示例**: 查看 [example/](./example/) 目录获取完整的使用示例，包括多个插件演示。

### 基本用法

```typescript
import { Dependency } from '@zhin.js/dependency';

// 创建并启动依赖树
const root = new Dependency('./entry.js');
await root.start();

// 打印依赖树
console.log(root.printTree('', true, true));

// 停止依赖树
await root.stop();
```

### 在插件中使用 Hooks

```typescript
// plugins/my-plugin.ts
import { onMount, onDispose, addListener } from '@zhin.js/dependency';

// 挂载钩子
onMount(() => {
  console.log('插件已挂载！');
});

// 添加事件监听器
const unsubscribe = addListener('my-event', () => {
  console.log('事件触发');
});

// 卸载钩子
onDispose(() => {
  unsubscribe();
  console.log('插件已卸载');
});

// 使用原生 import 导入子模块
import './child-plugin';

export default {};
```

### 继承 Dependency 类

完全支持类继承，创建自定义插件类：

```typescript
import { Dependency } from '@zhin.js/dependency';

class Plugin extends Dependency {
  public version: string = '1.0.0';
  
  constructor(filePath: string) {
    super(filePath);
  }
  
  getInfo(): string {
    return `${this.name} v${this.version}`;
  }
}

// 使用自定义类
const root = new Plugin('./entry.js');
await root.start();

// 所有子节点也是 Plugin 实例！
console.log(root.children[0] instanceof Plugin); // true
console.log(root.children[0].getInfo()); // 可以使用自定义方法
```

## 🔧 配置

### 环境变量

#### `DEPENDENCY_TREE_INCLUDE`

指定需要处理的路径（优先级最高，即使在 `node_modules` 中也会处理）。

**使用场景：**

1. **包含 npm 包中的插件** ⭐

```bash
# 场景：你的插件发布为 npm 包，用户安装后需要被依赖树系统处理
DEPENDENCY_TREE_INCLUDE=node_modules/@my-org/my-plugin
```

2. **混合本地和 npm 插件**

```bash
# 同时包含本地插件和多个 npm 包
DEPENDENCY_TREE_INCLUDE=src/plugins,node_modules/@org/plugin1,node_modules/@org/plugin2
```

3. **包含包内特定目录**

```bash
# 只处理包内的 plugins 目录
DEPENDENCY_TREE_INCLUDE=node_modules/@my-org/my-plugin/plugins
```

4. **支持插件生态系统**（社区插件 + 官方插件）⭐

```bash
# 同时支持社区插件 (zhin.js-*) 和官方插件 (@zhin.js/*)
DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/
```

#### `DEPENDENCY_TREE_EXCLUDE`

指定需要排除的路径（优先级第二）。

```bash
# 排除测试文件
DEPENDENCY_TREE_EXCLUDE=plugins/__tests__,plugins/**/*.test.ts
```

### 运行时配置

#### Bun

```json
{
  "scripts": {
    "start": "bun --preload @zhin.js/dependency/bun-preload.ts src/index.ts"
  }
}
```

#### tsx

```json
{
  "scripts": {
    "start": "tsx --import @zhin.js/dependency/register.mjs src/index.ts"
  }
}
```

#### Node.js（编译后）

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node --import @zhin.js/dependency/register.mjs dist/index.js"
  }
}
```

## 🧹 副作用自动管理

`@zhin.js/dependency` 提供了强大的副作用自动管理功能，能够自动包装全局副作用函数，并在插件卸载时自动清理，避免内存泄漏和资源占用。

### 支持的副作用函数

以下副作用函数会被自动包装和管理：

- ✅ `setInterval` - 定时器，自动 `clearInterval`
- ✅ `setTimeout` - 延时器，自动 `clearTimeout`
- ✅ `setImmediate` - 立即执行（Node.js），自动 `clearImmediate`

### 工作原理

当插件代码中调用这些副作用函数时，loader 会自动：

1. **拦截调用** - 记录返回的 ID 或注册的监听器
2. **注册清理** - 自动添加清理函数到 `onDispose`
3. **自动清理** - 插件卸载时自动清理所有副作用

### 使用示例

#### 传统方式（手动管理）❌

```typescript
// plugins/my-plugin.ts
import { onDispose } from '@zhin.js/dependency';

// 需要手动管理清理
const timerId = setInterval(() => {
  console.log('定时任务');
}, 1000);

onDispose(() => {
  clearInterval(timerId); // 手动清理
});
```

#### 自动管理方式（推荐）✅

```typescript
// plugins/my-plugin.ts

// 直接使用，自动清理！
setInterval(() => {
  console.log('定时任务');
}, 1000);

// 不需要手动调用 clearInterval
// 插件卸载时会自动清理
```

### 实际场景示例

#### 场景 1：轮询任务

```typescript
// plugins/polling-plugin.ts

// 轮询 API
setInterval(async () => {
  const data = await fetchAPI();
  processData(data);
}, 5000);

// 卸载时自动停止轮询，无需手动清理
```

#### 场景 2：立即执行任务

```typescript
// plugins/immediate-plugin.ts

// 立即执行（在当前事件循环结束后）
setImmediate(async () => {
  await processNextTask();
});

// 适用于需要在当前操作完成后立即执行的任务
setImmediate(() => {
  // 确保在当前 I/O 回调之后执行
  notifyCompletion();
});

// 卸载时自动清理
```

#### 场景 3：混合使用多种定时器

```typescript
// plugins/complex-plugin.ts

// 定时器 - 周期性执行
setInterval(() => console.log('每秒执行'), 1000);

// 延时器 - 延迟执行
setTimeout(() => console.log('5秒后执行'), 5000);

// 立即执行 - 当前事件循环后立即执行
setImmediate(() => console.log('立即执行'));

// 插件卸载时，所有副作用自动清理！
```

### 配置选项

#### 环境变量 `DEPENDENCY_WRAP_EFFECTS`

控制是否启用副作用自动管理功能。

```bash
# 禁用副作用包装（默认启用）
DEPENDENCY_WRAP_EFFECTS=false

# 或
DEPENDENCY_WRAP_EFFECTS=0
```

**使用场景：**

```json
{
  "scripts": {
    "dev": "tsx --import @zhin.js/dependency/register.mjs src/index.ts",
    "dev:no-wrap": "DEPENDENCY_WRAP_EFFECTS=false tsx --import @zhin.js/dependency/register.mjs src/index.ts"
  }
}
```

### 注意事项

#### 1. 非插件上下文

如果在非插件上下文中调用副作用函数（没有 Dependency 实例），包装器会静默失败，不影响正常使用：

```typescript
// 在普通模块中（非插件）
setInterval(() => {
  console.log('正常工作');
}, 1000);
// 不会自动清理，但不会报错
```

#### 2. 手动清理优先级更高

如果你手动调用了清理函数，自动清理会跳过：

```typescript
const timerId = setInterval(() => {}, 1000);
clearInterval(timerId); // 手动清理

// onDispose 时尝试再次清理是安全的（clearInterval 多次调用无副作用）
```

#### 3. 保留原始函数引用

如果需要访问原始的（未包装的）函数：

```typescript
// 在包装之前保存引用
const originalSetInterval = globalThis.setInterval;

// 使用原始函数（不会自动清理）
const timerId = originalSetInterval(() => {}, 1000);
```

### 优势

- ✅ **零心智负担** - 不需要记住手动清理
- ✅ **避免内存泄漏** - 自动清理所有副作用
- ✅ **简化代码** - 减少样板代码
- ✅ **类型安全** - 完整的 TypeScript 类型支持
- ✅ **向后兼容** - 可以通过环境变量禁用
- ✅ **非侵入式** - 在非插件上下文中正常工作

## 🪝 可扩展 Hook 系统

### 自动类型推断

通过 **Module Augmentation** 扩展 `Hooks` interface，实现自动类型推断：

```typescript
import { registerHook, useHook } from '@zhin.js/dependency';

// 1️⃣ 扩展类型定义
declare module '@zhin.js/dependency' {
  interface Hooks {
    logger: (message: string, level?: 'info' | 'warn' | 'error') => void;
    onBeforeMount: (callback: () => void) => void;
  }
}

// 2️⃣ 注册 hook
registerHook({
  name: 'logger',
  handler: (dep, message, level = 'info') => {
    console[level](`[${dep.name}] ${message}`);
  }
});

// 3️⃣ 使用（类型自动推断！）
export const logger = useHook('logger'); // (message: string, level?: 'info' | 'warn' | 'error') => void

// ✅ TypeScript 提供完整的类型检查和智能提示
logger('Hello', 'info');
```

### 内置 Hooks

- `addListener(event, listener)` - 添加事件监听器
- `onMount(hook)` - 添加挂载钩子
- `onDispose(hook)` - 添加卸载钩子
- `importModule(path)` - 导入子模块

### 自定义 Hooks API

- `registerHook(config)` - 注册自定义 hook
- `unregisterHook(name)` - 取消注册 hook
- `useHook(name)` - 创建 hook 函数（支持类型推断）
- `hasHook(name)` - 检查 hook 是否存在
- `getAllHooks()` - 获取所有已注册 hooks

## 🔥 热重载

`Dependency` 提供了 `reload()` 方法来支持热重载。你可以使用 `chokidar` 监听文件变化，然后调用 `reload()` 来重新加载模块。

### 基本示例

使用**事件驱动**的方式动态收集文件路径：

```typescript
import { Dependency } from '@zhin.js/dependency';
import chokidar from 'chokidar';

// 1. 创建依赖树和文件监听器
const root = new Dependency('./entry.js');
const watchedFiles = new Map<string, Dependency>();

// 2. 创建空的 watcher，准备动态添加文件
const watcher = chokidar.watch([], {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 100
  }
});

// 3. 监听 afterStart 事件，动态收集文件路径
root.on('afterStart', (dep: Dependency) => {
  watchedFiles.set(dep.filePath, dep);
  watcher.add(dep.filePath);
});

// 4. 启动依赖树（会触发 afterStart 事件）
await root.start();

// 5. 监听文件变化
watcher.on('change', async (changedPath: string) => {
  const dep = watchedFiles.get(changedPath);
    if (dep) {
      console.log(`📝 文件变更: ${dep.name}`);
      console.time('reload');
      
      try {
        const newDep = await dep.reload();
        watchedFiles.set(newDep.filePath, newDep);
      } catch (error) {
        console.error(`❌ [${dep.name}] 重载失败:`, error);
      }
      
      console.timeEnd('reload');
    }
});
```

### 热重载工作原理

当调用 `dep.reload()` 时，会自动：

1. **暂存子依赖** - 保存当前节点的 children
2. **卸载当前节点** - 调用 `dispose()`
3. **清除模块缓存** - 清除 require/import 缓存
4. **重新导入** - 父节点重新 import 该文件（或根节点重新 start）
5. **恢复子依赖** - 将暂存的 children 赋值给新节点
6. **重新挂载** - 调用新节点的 `mount()`
7. **返回新实例** - `reload()` 返回新的 `Dependency` 实例

### 关键特性

- ✅ **支持根节点热重载** - 即使没有 parent 也能 reload
- ✅ **返回新实例** - `reload()` 返回 `Promise<Dependency>`
- ✅ **事件驱动** - 使用 `afterStart` 事件动态收集依赖
- ✅ **保留子树** - 子依赖会自动迁移到新实例
- ✅ **灵活可控** - 完全控制监听策略和重载时机

### 优势

- 🚀 **性能优化** - 只监听实际需要的文件
- 🎯 **精确控制** - 可以根据需求定制监听策略
- 🔄 **增量更新** - 无需重新收集所有文件
- 💾 **内存友好** - 及时更新监听映射，避免内存泄漏
- 🛠️ **可扩展** - 可以结合其他工具（如 nodemon、pm2）

## 🧬 类继承指南

### 核心特性

- ✅ **完整继承支持** - 子节点自动使用父节点的类
- ✅ **类型安全** - 完整的 TypeScript 类型支持
- ✅ **生命周期保留** - 所有生命周期方法正常工作
- ✅ **热重载兼容** - 重载后的节点保持相同类型

### 基本继承

```typescript
import { Dependency } from '@zhin.js/dependency';

class Plugin extends Dependency {
  public version: string = '1.0.0';
  public author: string = 'unknown';

  constructor(filePath: string) {
    super(filePath);
  }

  // 添加自定义方法
  getInfo(): string {
    return `${this.name} v${this.version} by ${this.author}`;
  }
}

// 使用自定义类
const root = new Plugin('./entry.js');
await root.start();

// 所有子节点也是 Plugin 实例！
console.log(root.children[0] instanceof Plugin); // true
```

### 实际示例

#### 示例 1：添加配置系统

```typescript
interface PluginConfig {
  enabled: boolean;
  priority: number;
  dependencies?: string[];
}

class ConfigurablePlugin extends Dependency {
  private config: PluginConfig = {
    enabled: true,
    priority: 0
  };

  constructor(filePath: string, config?: Partial<PluginConfig>) {
    super(filePath);
    if (config) {
      this.config = { ...this.config, ...config };
    }
  }

  getConfig(): PluginConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<PluginConfig>): void {
    this.config = { ...this.config, ...config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
```

#### 示例 2：添加性能监控

```typescript
class MonitoredPlugin extends Dependency {
  private metrics = {
    loadTime: 0,
    mountTime: 0,
    childCount: 0
  };

  async start(): Promise<void> {
    const startTime = Date.now();
    await super.start();
    this.metrics.loadTime = Date.now() - startTime;
  }

  async mount(): Promise<void> {
    const startTime = Date.now();
    await super.mount();
    this.metrics.mountTime = Date.now() - startTime;
    this.metrics.childCount = this.children.length;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  printMetrics(): void {
    console.log(`📊 ${this.name} 性能指标:`);
    console.log(`   加载时间: ${this.metrics.loadTime}ms`);
    console.log(`   挂载时间: ${this.metrics.mountTime}ms`);
    console.log(`   子节点数: ${this.metrics.childCount}`);
  }
}
```

### 工作原理

当父节点导入子模块时，`importChild()` 方法会自动使用 `this.constructor` 来创建子节点：

```typescript
async importChild(importPath: string): Promise<Dependency> {
  const absolutePath = this.resolveImportPath(this.#filePath, importPath);
  
  // 使用父节点的构造函数创建子节点
  const child = new (this.constructor as typeof Dependency)(absolutePath);
  
  child.parent = this;
  this.children.push(child);
  await child.start();
  
  return child;
}
```

这确保了：
- ✅ 子节点使用与父节点相同的类
- ✅ 整个依赖树保持类型一致
- ✅ 自定义属性和方法在所有节点上可用

### 注意事项

#### 1. 构造函数参数

如果你的自定义类需要额外的构造函数参数，需要确保只使用 `filePath` 作为必需参数：

```typescript
// ✅ 正确：额外参数都是可选的
class MyPlugin extends Dependency {
  constructor(filePath: string, config?: MyConfig) {
    super(filePath);
    // ...
  }
}

// ❌ 错误：必需的额外参数会导致子节点创建失败
class MyPlugin extends Dependency {
  constructor(filePath: string, config: MyConfig) { // config 是必需的
    super(filePath);
    // ...
  }
}
```

**解决方案：** 使用默认值或可选参数：

```typescript
class MyPlugin extends Dependency {
  constructor(
    filePath: string,
    config: MyConfig = { /* 默认值 */ }
  ) {
    super(filePath);
    // ...
  }
}
```

#### 2. 异步初始化

如果需要异步初始化，使用生命周期方法而不是构造函数：

```typescript
class AsyncPlugin extends Dependency {
  private initialized: boolean = false;

  // ✅ 使用 start 方法
  async start(): Promise<void> {
    await this.initialize();
    await super.start();
  }

  private async initialize(): Promise<void> {
    // 异步初始化逻辑
    this.initialized = true;
  }
}
```

## 🔌 插件生态系统

### 支持多种命名规范

#### 1. 社区插件（前缀命名）

```
zhin.js-plugin1
zhin.js-my-plugin
zhin.js-awesome-feature
```

#### 2. 官方插件（组织命名）

```
@zhin.js/core
@zhin.js/plugin1
@zhin.js/database
```

### 配置方法

#### 方法 1：环境变量（推荐）

在 `.env` 文件或启动脚本中设置：

```bash
# 同时支持两种插件
DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/
```

#### 方法 2：package.json 脚本

```json
{
  "scripts": {
    "dev": "DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/ bun src/index.ts",
    "start": "DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/ tsx src/index.ts"
  }
}
```

#### 方法 3：使用 dotenv

```bash
# .env
DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/
```

```typescript
// index.ts
import 'dotenv/config';
import { Dependency } from '@zhin.js/dependency';

const root = new Dependency('./entry.js');
await root.start();
```

### 实际场景

#### 场景 1：纯官方插件生态

如果你的项目只使用官方插件（如 `@zhin.js/*`）：

```bash
DEPENDENCY_TREE_INCLUDE=node_modules/@zhin.js/
```

#### 场景 2：纯社区插件生态

如果你的项目只使用社区插件（如 `zhin.js-*`）：

```bash
DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-
```

#### 场景 3：混合生态 ⭐

同时支持官方和社区插件（推荐）：

```bash
DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/
```

#### 场景 4：本地插件 + npm 插件

同时支持本地开发和 npm 安装的插件：

```bash
DEPENDENCY_TREE_INCLUDE=src/plugins,node_modules/zhin.js-,node_modules/@zhin.js/
```

#### 场景 5：选择性包含

只包含特定的插件：

```bash
DEPENDENCY_TREE_INCLUDE=node_modules/@zhin.js/core,node_modules/zhin.js-auth,node_modules/zhin.js-database
```

### 排除特定插件

使用 `DEPENDENCY_TREE_EXCLUDE` 排除不需要的插件：

```bash
# 包含所有 zhin.js 插件，但排除测试和开发插件
DEPENDENCY_TREE_INCLUDE=node_modules/zhin.js-,node_modules/@zhin.js/
DEPENDENCY_TREE_EXCLUDE=node_modules/zhin.js-dev,node_modules/@zhin.js/testing
```

### 发布插件为 npm 包

#### 插件包作者（发布方）

在你的插件包 README 中说明：

```markdown
## 使用方法

安装插件：

\`\`\`bash
npm install @your-org/your-plugin
\`\`\`

配置环境变量以启用依赖树转换：

\`\`\`bash
DEPENDENCY_TREE_INCLUDE=node_modules/@your-org/your-plugin
\`\`\`

或者在 `package.json` 中：

\`\`\`json
{
  "scripts": {
    "start": "DEPENDENCY_TREE_INCLUDE=node_modules/@your-org/your-plugin tsx src/index.ts"
  }
}
\`\`\`
```

#### 插件使用者

```bash
# .env 文件
DEPENDENCY_TREE_INCLUDE=node_modules/@my-org/plugin1,node_modules/@my-org/plugin2
```

或者在启动命令中：

```json
{
  "scripts": {
    "start": "DEPENDENCY_TREE_INCLUDE=node_modules/@my-org/my-plugin tsx src/index.ts"
  }
}
```

## 📚 API 文档

### `Dependency` 类

#### 构造函数

```typescript
new Dependency(filePath: string)
```

#### 方法

- `async start()` - 启动依赖（导入模块并构建树）
- `async mount()` - 挂载（执行 onMount hooks）
- `async dispose()` - 卸载（执行 onDispose hooks）
- `async stop()` - 停止（dispose 并级联卸载子节点）
- `async reload(): Promise<Dependency>` - 热重载，返回新的 Dependency 实例（支持根节点）
- `printTree(prefix?, showListeners?, showPaths?)` - 打印树结构
- `toJSON()` - 导出为 JSON
- `dispatch(event, ...args)` - 触发当前节点的事件
- `broadcast(event, ...args)` - 广播事件到整个子树

#### 属性

- `name` - 依赖名称
- `filePath` - 文件路径
- `parent` - 父依赖
- `children` - 子依赖数组

#### 继承自 EventEmitter

```typescript
// 监听事件
dep.on('afterMount', (dep) => console.log('挂载完成'));

// 触发事件
dep.emit('custom-event', data);

// 其他 EventEmitter 方法
dep.once(event, listener);
dep.off(event, listener);
dep.removeAllListeners(event);
```

## 🎨 生命周期

```
┌─────────────┐
│   create    │  new Dependency()
└──────┬──────┘
       │
┌──────▼──────┐
│    start    │  导入模块，构建树
└──────┬──────┘
       │
┌──────▼──────┐
│    mount    │  执行 onMount hooks
└──────┬──────┘
       │
   ┌───▼────┐
   │ active │  运行中...
   └───┬────┘
       │
┌──────▼──────┐
│   dispose   │  执行 onDispose hooks
└──────┬──────┘
       │
┌──────▼──────┐
│    stop     │  级联卸载子节点
└─────────────┘
```

### 生命周期事件

Dependency 类继承自 EventEmitter，在生命周期的各个阶段会触发相应事件：

- `beforeStart` - 开始启动前
- `afterStart` - 启动完成后
- `beforeMount` - 开始挂载前
- `afterMount` - 挂载完成后
- `beforeDispose` - 开始卸载前
- `afterDispose` - 卸载完成后
- `beforeReload` - 开始重载前
- `afterReload` - 重载完成后
- `fileChange` - 文件变更时
- `error` - 发生错误时

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT
