# @zhin.js/dependency

基于运行时依赖树分析的模块管理系统，提供自动依赖去重、热重载和生命周期管理功能。

## ✨ 核心特性

### 1. **自动依赖去重**
- 全局唯一实例：同一文件路径在整个依赖树中只有一个实例
- 引用计数：通过 `refs` 集合追踪所有引用者
- 智能共享：自动识别共享依赖并显示引用计数

### 2. **热重载 (Hot Reload)**
- 原地重载：根节点重载时保持引用不变
- 智能 Diff：自动比较新旧子依赖，保留未变化的子树
- 状态保持：共享依赖在重载时保持状态和监听器

### 3. **生命周期管理**
- 细粒度生命周期钩子
- 事件冒泡机制：从叶子节点向根节点传播
- 自动清理：停止时自动清理子依赖和副作用

### 4. **副作用自动管理**
- 自动包装全局副作用函数（`setInterval`, `setTimeout`, `setImmediate`）
- 模块卸载时自动清理副作用
- 通过环境变量 `DEPENDENCY_WRAP_EFFECTS` 控制开关

## 📦 安装

```bash
pnpm add @zhin.js/dependency
```

## 🚀 快速开始

### 基础用法

```typescript
import { Dependency, onMount, onDispose, getCurrentDependency } from '@zhin.js/dependency';

// 插件代码 (plugin.ts)
export const name = 'my-plugin';

onMount(() => {
  console.log('插件已挂载');
});

onDispose(() => {
  console.log('插件已卸载');
});

// 导入子依赖
const dep = getCurrentDependency();
if (dep) {
  await dep.importChild('./child-plugin');
}

// 主程序
const root = new Dependency('./plugin.ts');
await root.start();

console.log(root.printTree('', true, true));
// my-plugin (0 listeners)
// └── child-plugin (0 listeners)

await root.stop();
```

### 热重载

```typescript
import { Dependency } from '@zhin.js/dependency';
import chokidar from 'chokidar';

const root = new Dependency('./plugin.ts');
await root.start();

// 监听文件变化
chokidar.watch('./plugin.ts').on('change', async () => {
  console.log('🔄 检测到文件变化，重载中...');
  await root.reload();
  console.log('✅ 重载完成');
});
```

## 🔧 核心 API

### Dependency 类

#### 构造函数
```typescript
constructor(filePath: string)
```

#### 生命周期方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `start()` | 启动依赖：初始化模块、挂载、启动子依赖 | `Promise<void>` |
| `mount()` | 挂载：执行 `onMount` 钩子 | `Promise<void>` |
| `dispose()` | 卸载：执行 `onDispose` 钩子和副作用清理 | `Promise<void>` |
| `stop()` | 停止：卸载、清理缓存、递归停止子依赖 | `Promise<void>` |
| `reload()` | 重载：卸载、清理、重新导入、Diff 子依赖 | `Promise<Dependency>` |

#### 依赖管理方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `importChild(path)` | 导入子依赖（自动去重） | `Promise<P>` |
| `removeChild(child)` | 移除子依赖（引用计数减 1） | `Promise<void>` |
| `init()` | 初始化模块（导入代码并注册到全局池） | `Promise<void>` |

#### 属性 & Getter

| 属性 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 依赖名称（从文件名提取） |
| `filePath` | `string` | 文件绝对路径 |
| `children` | `P[]` | 子依赖列表（通过 Symbol 实现） |
| `refs` | `Set<string>` | 引用者文件路径集合 |
| `parent` | `P \| null` | 父依赖（`refs` 的第一个元素） |
| `root` | `P` | 根依赖 |
| `isRoot` | `boolean` | 是否为根节点（`refs.size === 0`） |
| `started` | `boolean` | 是否已启动 |
| `mounted` | `boolean` | 是否已挂载 |
| `reloading` | `boolean` | 是否正在重载 |

#### 工具方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `getPath()` | 获取从根到当前节点的路径 | `Dependency[]` |
| `getDepth()` | 获取当前节点深度 | `number` |
| `printTree()` | 打印依赖树 | `string` |
| `toJSON()` | 序列化为 JSON | `object` |

### Hooks API

#### onMount
在依赖挂载时执行
```typescript
onMount(() => {
  console.log('已挂载');
});
```

#### onDispose
在依赖卸载时执行
```typescript
onDispose(() => {
  console.log('已卸载');
});

// 内部清理（在生命周期监听器清理前执行）
onDispose(() => {
  console.log('内部清理');
}, true);
```

#### getCurrentDependency
获取当前模块的 Dependency 实例
```typescript
const dep = getCurrentDependency();
if (dep) {
  await dep.importChild('./child');
}
```

## 📋 生命周期详解

### 启动流程 (start)

```
1. before-start  ──▶ 向上冒泡
2. self.start    ──▶ 本节点监听器
3. init()        ──▶ 导入模块代码（如果未初始化）
4. mount()       ──▶ 挂载钩子
   ├─ before-mount ──▶ 向上冒泡
   ├─ self.mounted ──▶ onMount 钩子
   └─ mounted      ──▶ 向上冒泡
5. children.start() ──▶ 递归启动子依赖
6. started       ──▶ 向上冒泡
```

### 卸载流程 (dispose)

```
1. before-dispose ──▶ 向上冒泡
2. self.dispose   ──▶ onDispose 钩子
3. #onSelfDispose ──▶ 内部副作用清理
4. disposed       ──▶ 向上冒泡
```

### 停止流程 (stop)

```
检查: refs.size > 0 ? 返回（还有引用者）
├─ before-stop     ──▶ 向上冒泡
├─ self.stop       ──▶ 本节点监听器
├─ dispose()       ──▶ 卸载
├─ 清理全局池      ──▶ globalDepMap.delete()
├─ 清理模块缓存    ──▶ removeModuleCache()
├─ removeChild()   ──▶ 递归移除子依赖（refs-1）
├─ stopped         ──▶ 向上冒泡
└─ started = false
```

### 重载流程 (reload)

```
1. before-reload   ──▶ 向上冒泡
2. self.reload     ──▶ 本节点监听器
3. reloading       ──▶ 向上冒泡
4. 保存子依赖      ──▶ savedChildren = [...this.children]

5. #cleanupBeforeReload()
   ├─ dispose()    ──▶ 卸载
   ├─ parent?.removeChild(this) ──▶ 从父节点移除
   └─ removeModuleCache() ──▶ 清理缓存

6. #reloadNode()
   ├─ 如果是根节点:
   │  ├─ this.#cleanLifecycleListeners() ──▶ 清理生命周期监听器
   │  ├─ this[childrenKey].clear()       ──▶ 清空子依赖
   │  ├─ await this.init()               ──▶ 重新导入模块
   │  └─ return this                     ──▶ 返回自己
   └─ 如果有父节点:
      └─ return await this.parent.importChild(path) ──▶ 父节点重新导入

7. #updateChildren(newNode, savedChildren)
   ├─ #diffChildren()      ──▶ 比较新旧子依赖
   │  ├─ removedChildren  ──▶ 旧的但新的没有
   │  └─ addedChildren    ──▶ 新的但旧的没有
   ├─ #removeChildren()    ──▶ 移除已删除的子依赖
   ├─ #addChildren()       ──▶ 添加新增的子依赖
   └─ 更新 childrenKey    ──▶ 用 savedChildren 覆盖

8. await newNode.start()  ──▶ 启动新节点
9. reloaded              ──▶ 向上冒泡
```

## 🎯 核心机制详解

### 1. 依赖去重机制

#### 全局依赖池
```typescript
private static globalDepMap = new Map<string, Dependency>();
```
- **Key**: 文件绝对路径（标准化后）
- **Value**: Dependency 实例
- **作用**: 确保同一文件只有一个实例

#### 引用计数 (refs)
```typescript
public refs: Set<string> = new Set();
```
- 存储所有引用者的文件路径
- 首次导入者也在 `refs` 中
- `refs.size` 即为总引用计数

#### parent (Getter)
```typescript
get parent(): P | null {
  return this.refs.size > 0 
    ? Dependency.globalDepMap.get(this.refs.values().next().value!) as P 
    : null;
}
```
- 动态计算，返回 `refs` 的第一个元素
- 代表首次导入者
- Set 迭代顺序稳定，保证 `parent` 始终是第一个

#### importChild 逻辑
```typescript
async importChild(importPath: string): Promise<P> {
  const normalizedPath = this.resolveFilePath(absolutePath);
  let child = Dependency.globalDepMap.get(normalizedPath);
  
  if (!child) {
    // 首次导入：创建实例并初始化
    child = new (this.constructor as Constructor<P>)(normalizedPath);
    await child.init();  // 导入模块代码
  }
  
  // 建立引用关系
  child.refs.add(this.#filePath);
  this[childrenKey].add(child.filePath);
  
  return child;
}
```

#### removeChild 逻辑
```typescript
async removeChild(child: P): Promise<void> {
  child.refs.delete(this.#filePath);
  this[childrenKey].delete(child.filePath);
  
  if (!child.refs.size) {
    await child.stop();  // 引用计数归零，停止
  }
}
```

### 2. 热重载机制

#### Clone-Diff-Merge 策略

**根节点重载**：
```
保存 children → dispose → 清理 → 重新 init → diff → 恢复 children → start
```

**非根节点重载**：
```
保存 children → dispose → 父节点重新 importChild → diff → 恢复 children → start
```

#### Diff 算法
```typescript
#diffChildren(newNode, savedChildren) {
  // Removed: 在 saved 中但不在 new 中
  const removedChildren = savedChildren.filter(
    child => !newNode.children.find(c => c.filePath === child.filePath)
  );
  
  // Added: 在 new 中但不在 saved 中
  const addedChildren = newNode.children.filter(
    child => !savedChildren.find(c => c.filePath === child.filePath)
  );
  
  // Kept: 都存在的会被自动保留（不在 removed 中）
  return { removedChildren, addedChildren };
}
```

#### 状态保持
- **Kept 子依赖**: 不重新创建，保持原实例
- **Added 子依赖**: 新创建或从全局池复用
- **Removed 子依赖**: 调用 `removeChild`，引用计数减 1

### 3. children 的 Symbol 实现

```typescript
const childrenKey = Symbol('children');

[childrenKey]: Set<string> = new Set();  // 存储子依赖的文件路径

get children(): P[] {
  return Array.from(this[childrenKey])
    .map(filePath => Dependency.globalDepMap.get(filePath) as P);
}
```

**优势**：
- 通过文件路径间接引用，避免循环引用
- 从全局池动态获取，保证始终是最新实例
- 支持 Diff 和更新操作

### 4. 事件系统

#### 事件冒泡
```typescript
async dispatchAsync(event: string, ...args: any[]): Promise<void> {
  if (this.parent) 
    await this.parent.dispatchAsync(event, ...args);
  else 
    await this.broadcastAsync(event, ...args);
}
```
- 有父节点：向父节点传播
- 无父节点（根节点）：广播到整个子树

#### 事件广播
```typescript
async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  await this.emitAsync(event, ...args);  // 触发自己的监听器
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);  // 递归广播
  }
}
```

## 🔌 Loader 使用

### Tsx (Node.js)

```bash
tsx --import @zhin.js/dependency/register.mjs index.ts
```

或在 `package.json` 中：
```json
{
  "scripts": {
    "dev": "tsx --import @zhin.js/dependency/register.mjs src/index.ts"
  }
}
```

### Bun

```bash
bun --preload @zhin.js/dependency/bun-preload.ts index.ts
```

或在 `package.json` 中：
```json
{
  "scripts": {
    "dev": "bun --preload @zhin.js/dependency/bun-preload.ts src/index.ts"
  }
}
```

### 环境变量

```bash
# 禁用副作用自动管理
DEPENDENCY_WRAP_EFFECTS=false tsx --import @zhin.js/dependency/register.mjs index.ts
```

## 📊 生命周期事件完整列表

### 本节点事件 (self.*)
- `self.start`: 启动开始
- `self.mounted`: 挂载完成（onMount 钩子）
- `self.dispose`: 卸载开始（onDispose 钩子）
- `self.stop`: 停止开始
- `self.reload`: 重载开始

### 冒泡事件
- `before-start`: 启动前
- `started`: 启动完成
- `before-mount`: 挂载前
- `mounted`: 挂载完成
- `before-dispose`: 卸载前
- `disposed`: 卸载完成
- `before-stop`: 停止前
- `stopped`: 停止完成
- `before-reload`: 重载前
- `reloading`: 重载中
- `reloaded`: 重载完成

### 错误事件
- `error`: 通用错误
- `reload.error`: 重载错误

## 🎨 实用场景

### 插件系统
```typescript
class PluginDependency extends Dependency {
  async enable() {
    await this.start();
  }
  
  async disable() {
    await this.stop();
  }
  
  async reload() {
    return super.reload() as Promise<PluginDependency>;
  }
}

const plugin = new PluginDependency('./plugin.ts');
await plugin.enable();
```

### 微服务热重载
```typescript
import { Dependency } from '@zhin.js/dependency';
import chokidar from 'chokidar';

const services = new Map<string, Dependency>();

async function loadService(servicePath: string) {
  const service = new Dependency(servicePath);
  await service.start();
  services.set(servicePath, service);
  
  chokidar.watch(servicePath).on('change', async () => {
    await service.reload();
  });
}
```

### 依赖树可视化
```typescript
const root = new Dependency('./main.ts');
await root.start();

console.log(root.printTree('', true, true));
// main (3 listeners)
// ├── logger (1 listeners) [shared ×2]
// ├── child (2 listeners)
// │   └── timer (1 listeners)
// └── parent (2 listeners)
//     └── child (2 listeners) [shared ×2]
```

## 🔍 调试技巧

### 打印依赖树
```typescript
console.log(dep.printTree('', true, true));
```

### 监听所有事件
```typescript
const events = [
  'before-start', 'started', 'before-mount', 'mounted',
  'before-dispose', 'disposed', 'before-stop', 'stopped',
  'before-reload', 'reloading', 'reloaded', 'error'
];

events.forEach(event => {
  root.on(event, (dep) => {
    console.log(`[${event}] ${dep.name}`);
  });
});
```

### 查看引用关系
```typescript
console.log('引用者数量:', dep.refs.size);
console.log('引用者路径:', Array.from(dep.refs));
console.log('父节点:', dep.parent?.name);
console.log('子节点:', dep.children.map(c => c.name));
```

## ⚙️ 高级配置

### 自定义路径解析
```typescript
class CustomDependency extends Dependency {
  protected resolveFilePath(filePath: string): string {
    // 自定义路径解析逻辑
    return super.resolveFilePath(filePath);
  }
}
```

### 自定义模块初始化
```typescript
class CustomDependency extends Dependency {
  async init() {
    // 自定义初始化逻辑
    await super.init();
    // 额外处理
  }
}
```

## 📝 注意事项

1. **循环依赖**: 自动处理，通过全局池去重
2. **内存泄漏**: `stop()` 时自动清理缓存和副作用
3. **热重载**: 根节点重载保持引用，非根节点创建新实例
4. **共享依赖**: 通过 `refs.size` 追踪，引用计数归零时才停止
5. **Symbol children**: 通过文件路径间接引用，避免实例循环引用

## 📄 License

MIT

## 🤝 贡献

欢迎提交 Issue 和 PR！
