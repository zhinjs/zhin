# 生命周期事件变更说明

## 📋 变更概览

本文档说明 `@zhin.js/dependency` 生命周期事件的最新变化。

## 🔄 事件名称变更

### 旧版本 → 新版本

| 旧事件名 | 新事件名 | 说明 |
|---------|---------|------|
| `afterStart` | `started` | 启动完成后触发（在 mount 之后）|
| `afterMount` | `mounted` | 挂载完成后触发 |
| `afterDispose` | `disposed` | 卸载完成后触发 |
| `afterReload` | `reloaded` | 重载完成后触发 |
| ❌ | `before-stop` | **新增** - 停止前触发 |
| ❌ | `self.stop` | **新增** - 当前节点停止时触发 |
| ❌ | `stopped` | **新增** - 停止完成后触发 |
| ❌ | `reloading` | **新增** - 正在重载中 |

## 📌 完整的生命周期事件列表

### 启动阶段 (start)

1. `before-start` - 开始启动前
2. `self.start` - 当前节点启动时（不冒泡）
3. [导入模块]
4. [执行 mount()]
5. `started` - 启动完成后（在 mount 之后）✨

### 挂载阶段 (mount)

1. `before-mount` - 开始挂载前
2. `self.mounted` - 当前节点挂载时（不冒泡）
3. `mounted` - 挂载完成后

### 卸载阶段 (dispose)

1. `before-dispose` - 开始卸载前
2. `self.dispose` - 当前节点卸载时（不冒泡）
3. `disposed` - 卸载完成后

### 停止阶段 (stop) ✨ 新增

1. `before-stop` - 开始停止前
2. `self.stop` - 当前节点停止时（不冒泡）
3. [执行 dispose()]
4. [停止所有子节点]
5. `stopped` - 停止完成后

### 重载阶段 (reload)

1. `before-reload` - 开始重载前
2. `self.reload` - 当前节点重载时（不冒泡）
3. `reloading` - 正在重载中 ✨
4. [执行 dispose()]
5. [清除缓存]
6. [重新导入]
7. `reloaded` - 重载完成后（成功或失败都触发，在 finally 中）

### 错误处理

- `error` - 发生错误时
- `reload.error` - 重载错误时

## 🔍 事件冒泡机制

### `self.*` 事件（不冒泡）

仅在当前节点触发：
- `self.start`
- `self.mounted`
- `self.dispose`
- `self.stop`
- `self.reload`

**用途**：监听单个节点的状态变化

```typescript
dep.on('self.mounted', (dep) => {
  console.log('仅本节点挂载');
});
```

### 广播事件（冒泡到根节点）

会向上冒泡到根节点：
- `started`
- `mounted`
- `stopped`
- `reloaded`
- 所有 `before-*` 事件

**用途**：监听整个依赖树的状态变化

```typescript
root.on('started', (dep) => {
  console.log(`任意节点启动: ${dep.name}`);
});
```

## 📝 迁移指南

### 1. 更新事件监听

**旧代码：**
```typescript
root.on('afterStart', (dep) => {
  console.log('启动完成');
});

root.on('afterMount', (dep) => {
  console.log('挂载完成');
});

root.on('afterReload', (dep) => {
  console.log('重载完成');
});
```

**新代码：**
```typescript
root.on('started', (dep) => {
  console.log('启动完成');
});

root.on('mounted', (dep) => {
  console.log('挂载完成');
});

root.on('reloaded', (dep) => {
  console.log('重载完成');
});
```

### 2. 热重载文件监听

**旧代码：**
```typescript
root.on('afterStart', (dep) => {
  watchedFiles.set(dep.filePath, dep);
  watcher.add(dep.filePath);
});
```

**新代码：**
```typescript
// 启动时添加监听
root.on('started', (dep) => {
  watchedFiles.set(dep.filePath, dep);
  watcher.add(dep.filePath);
});

// 停止时移除监听（新增）
root.on('stopped', (dep) => {
  watchedFiles.delete(dep.filePath);
  watcher.unwatch(dep.filePath);
});
```

### 3. 停止事件监听（新功能）

**新增功能：**
```typescript
// 监听停止前
root.on('before-stop', (dep) => {
  console.log(`即将停止: ${dep.name}`);
});

// 监听停止后
root.on('stopped', (dep) => {
  console.log(`已停止: ${dep.name}`);
  // 清理资源、移除监听等
});
```

## ⚠️ 重要变化

### 1. `started` 触发时机变化

**旧版本 (`afterStart`)**：
- 在模块导入后立即触发
- 在 `mount()` 之前触发

**新版本 (`started`)**：
- 在 `mount()` 之后触发
- 确保节点完全就绪后才触发

```typescript
// 旧版本
// afterStart → mount → ...

// 新版本  
// mount → started → ...
```

### 2. 新增 `stopped` 事件

现在可以监听节点停止事件，用于：
- 清理文件监听
- 移除资源引用
- 更新监听映射

```typescript
root.on('stopped', (dep) => {
  // 清理工作
  watchedFiles.delete(dep.filePath);
  watcher.unwatch(dep.filePath);
});
```

### 3. 重载事件更细粒度

新增重载相关事件，提供更精确的状态追踪：

```typescript
root.on('before-reload', (dep) => {
  console.log('准备重载');
});

root.on('reloading', (dep) => {
  console.log('正在重载');
});

root.on('reloaded', (dep) => {
  console.log('重载完成（成功或失败）');
});

root.on('reload.error', (dep, error) => {
  console.error('重载失败', error);
});
```

## 🎯 最佳实践

### 1. 使用 `started` 而非 `self.start`

对于热重载等需要追踪所有节点的场景：

```typescript
// ✅ 推荐：捕获所有节点
root.on('started', (dep) => {
  watchedFiles.set(dep.filePath, dep);
});

// ❌ 不推荐：只捕获根节点
root.on('self.start', (dep) => {
  watchedFiles.set(dep.filePath, dep);
});
```

### 2. 配对使用 `started` 和 `stopped`

确保资源正确管理：

```typescript
const resources = new Map();

root.on('started', (dep) => {
  resources.set(dep.filePath, createResource(dep));
});

root.on('stopped', (dep) => {
  const resource = resources.get(dep.filePath);
  resource?.cleanup();
  resources.delete(dep.filePath);
});
```

### 3. 使用 `reloaded` 进行统一处理

`reloaded` 在成功和失败时都会触发：

```typescript
root.on('reloaded', (dep) => {
  // 统一的重载后处理
  updateUI(dep);
  notifyUser(`${dep.name} 已更新`);
});

root.on('reload.error', (dep, error) => {
  // 只处理错误情况
  showError(error);
});
```

## 📚 相关文档

- [主文档](./README.md)
- [热重载指南](./HOT-RELOAD-GUIDE.md)
- [API 文档](./README.md#-api-文档)

## 🔗 向后兼容性

**注意**: 旧的事件名已经移除，不再支持。请更新代码使用新的事件名。

如果您需要支持旧版本，可以同时监听多个事件：

```typescript
// 兼容新旧版本
function onStarted(callback) {
  root.on('started', callback);
  root.on('afterStart', callback); // 旧版本
}
```

但建议尽快迁移到新的事件名。

