# @zhin.js/dependency 完整示例

这是一个完整的示例项目，展示如何使用 `@zhin.js/dependency` 构建插件系统。

## 📁 项目结构

```
example/
├── package.json           # 项目配置
├── README.md             # 本文件
├── tsconfig.json         # TypeScript 配置
├── src/
│   └── index.ts          # 主入口
└── plugins/
    ├── timer-plugin.ts   # 定时器插件示例
    ├── logger-plugin.ts  # 日志插件示例
    ├── database-plugin.ts # 数据库插件示例
    └── parent-plugin.ts  # 父子插件示例
```

## 🚀 快速开始

### 安装依赖

```bash
cd examples/dependency
pnpm install
```

### 运行示例

```bash
# 基础示例 - 完整功能演示
pnpm dev

# 热重载演示 - 实时代码更新
pnpm hot-reload

# 使用 Bun 运行
pnpm dev:bun

# 禁用副作用包装
pnpm dev:no-wrap
```

## 📚 示例说明

### 1. 基础插件 (`plugins/logger-plugin.ts`)

展示最基本的插件结构：
- 使用 `onMount` 钩子
- 使用 `onDispose` 钩子
- 导出配置

### 2. 定时器插件 (`plugins/timer-plugin.ts`)

展示副作用自动管理：
- `setInterval` 自动清理
- `setTimeout` 自动清理
- `setImmediate` 自动清理

### 3. 数据库插件 (`plugins/database-plugin.ts`)

展示资源管理：
- 模拟数据库连接
- 自动清理连接
- 错误处理

### 4. 父子插件 (`plugins/parent-plugin.ts`)

展示依赖树结构：
- 父插件导入子插件
- 子插件自动成为依赖节点
- 级联停止

### 5. 热重载插件 (`plugins/hot-reload-plugin.ts`)

展示热重载功能：
- 修改代码实时生效
- 自动清理旧插件
- 保留子依赖树

### 6. 主入口 (`src/index.ts`)

展示完整的使用流程：
- 创建根 Dependency
- 启动插件系统
- 监听生命周期事件
- 优雅停止

### 7. 热重载演示 (`src/hot-reload-demo.ts`)

展示热重载实现：
- 使用 chokidar 监听文件
- 动态收集依赖文件
- 自动重载变化的插件
- 实时查看效果

## 🎯 学习要点

### 生命周期管理

```typescript
import { Dependency } from '@zhin.js/dependency';

const root = new Dependency('./plugins/my-plugin.ts');

// 1. 启动（start）
await root.start();  // 导入模块 → 构建依赖树 → 挂载

// 2. 停止（stop）
await root.stop();   // 卸载 → 级联停止子依赖
```

### Hooks 使用

```typescript
import { onMount, onDispose } from '@zhin.js/dependency';

onMount(() => {
  console.log('插件已挂载');
});

onDispose(() => {
  console.log('插件正在卸载');
});
```

### 副作用自动管理

```typescript
// 自动清理，无需手动管理
setInterval(() => {
  console.log('定时任务');
}, 1000);

setTimeout(() => {
  console.log('延时任务');
}, 5000);

setImmediate(() => {
  console.log('立即执行');
});
```

### 事件系统

```typescript
const root = new Dependency('./entry.ts');

// 监听生命周期事件
root.on('after-start', (dep) => {
  console.log(`${dep.name} 已启动`);
});

root.on('after-mount', (dep) => {
  console.log(`${dep.name} 已挂载`);
});

root.on('error', (dep, error) => {
  console.error(`${dep.name} 发生错误:`, error);
});

await root.start();
```

### 热重载

```typescript
import chokidar from 'chokidar';

const watchedFiles = new Map();
const watcher = chokidar.watch([]);

// 收集依赖文件
root.on('after-start', (dep) => {
  watchedFiles.set(dep.filePath, dep);
  watcher.add(dep.filePath);
});

// 监听文件变化
watcher.on('change', async (path) => {
  const dep = watchedFiles.get(path);
  if (dep) {
    const newDep = await dep.reload();
    watchedFiles.set(path, newDep);
  }
});
```

## 🔧 高级用法

### 自定义插件类

```typescript
import { Dependency } from '@zhin.js/dependency';

class Plugin extends Dependency {
  public version = '1.0.0';
  
  getInfo() {
    return `${this.name} v${this.version}`;
  }
}

const root = new Plugin('./entry.ts');
await root.start();

// 所有子节点也是 Plugin 实例
console.log(root.children[0].getInfo());
```

### 注册自定义 Hook

```typescript
import { registerHook, useHook } from '@zhin.js/dependency';

// 1. 扩展类型
declare module '@zhin.js/dependency' {
  interface Hooks {
    logger: (message: string, level?: 'info' | 'warn' | 'error') => void;
  }
}

// 2. 注册 Hook
registerHook({
  name: 'logger',
  handler: (dep, message, level = 'info') => {
    console[level](`[${dep.name}] ${message}`);
  }
});

// 3. 在插件中使用
export const logger = useHook('logger');
logger('Hello', 'info');
```

## 📖 相关文档

- **[本目录 README](./README.md)** - 完整示例说明
- **[热重载指南](./HOT-RELOAD-GUIDE.md)** - 热重载详细教程
- **[运行指南](./RUNNING.md)** - 运行说明和预期输出
- **[主文档](../../packages/dependency/README.md)** - 完整的 API 文档
- **[热重载文档](../../packages/dependency/README.md#-热重载)** - 热重载 API
- **[类继承指南](../../packages/dependency/README.md#-类继承指南)** - 继承用法

## 🤝 反馈

如果有任何问题或建议，欢迎提交 Issue！

