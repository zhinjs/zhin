# 🔥 热重载演示指南

## 概述

本指南展示如何使用 `@zhin.js/dependency` 的热重载功能，实现代码修改后自动重载，无需重启进程。

## 🚀 快速开始

### 1. 安装依赖

```bash
cd examples/dependency
pnpm install
```

确保安装了 `chokidar`：

```bash
pnpm add -D chokidar
```

### 2. 运行热重载演示

```bash
pnpm hot-reload
```

或者：

```bash
tsx --import @zhin.js/dependency/register.mjs src/hot-reload-demo.ts
```

### 3. 测试热重载

保持程序运行，然后修改 `plugins/hot-reload-plugin.ts`：

#### 测试 1: 修改版本号

```typescript
// 将版本号从 1 改为 2
const VERSION = 2;
```

**预期效果**：
- 旧插件卸载（定时器自动清理）
- 新插件加载并挂载
- 新的定时器开始运行

#### 测试 2: 修改定时器间隔

```typescript
// 将间隔从 2000ms 改为 1000ms
setInterval(() => {
  counter++;
  console.log(`💫 [v${VERSION}] 定时任务执行 #${counter}`);
}, 1000); // 从 2000 改为 1000
```

**预期效果**：
- 插件重载
- 定时器以新的间隔执行

#### 测试 3: 修改消息内容

```typescript
onMount(() => {
  console.log(`✅ [Hot Reload Plugin v${VERSION}] 插件已挂载`);
  
  // 修改这些消息
  console.log('   🎉 这是修改后的欢迎消息！');
  console.log('   🔥 热重载真的很酷！');
});
```

**预期效果**：
- 新消息显示在控制台

## 📊 运行输出示例

### 初始启动

```
============================================================
🔥 @zhin.js/dependency 热重载演示
============================================================

📝 设置文件监听器...

🚀 启动插件...

🔥 [Hot Reload Plugin v1] 模块已加载
✅ 开始监听: hot-reload-plugin (/path/to/hot-reload-plugin.ts)
✅ [Hot Reload Plugin v1] 插件已挂载
   👋 欢迎使用热重载功能！
   💡 尝试修改此文件并保存

✅ 插件已启动

📊 依赖树结构:

hot-reload-plugin (2 listeners)

============================================================
💡 热重载已启用！
   尝试修改 plugins/hot-reload-plugin.ts 文件
   系统会自动检测并重载插件

   按 Ctrl+C 退出
============================================================

💫 [v1] 定时任务执行 #1
💫 [v1] 定时任务执行 #2
```

### 文件修改后（VERSION 改为 2）

```
📝 检测到文件变化: /path/to/hot-reload-plugin.ts
🔄 重载插件: hot-reload-plugin
🛑 [Hot Reload Plugin v1] 插件正在卸载
   执行了 3 次定时任务
🔥 [Hot Reload Plugin v2] 模块已加载
✅ [Hot Reload Plugin v2] 插件已挂载
   👋 欢迎使用热重载功能！
   💡 尝试修改此文件并保存
✅ 重载成功: hot-reload-plugin
⏱️  重载耗时: 45.123ms

📊 更新后的依赖树:

hot-reload-plugin (2 listeners)

💡 继续监听文件变化...

💫 [v2] 定时任务执行 #1
💫 [v2] 定时任务执行 #2
```

## 🔧 工作原理

### 1. 文件监听

```typescript
// 使用 chokidar 监听文件变化
const watcher = chokidar.watch([], {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 300,  // 等待文件写入稳定
    pollInterval: 100
  }
});
```

### 2. 动态收集依赖

```typescript
// 监听 afterStart 事件，自动收集所有依赖的文件路径
root.on('after-start', (dep: Dependency) => {
  watchedFiles.set(dep.filePath, dep);
  watcher.add(dep.filePath);
});
```

### 3. 热重载执行

```typescript
watcher.on('change', async (changedPath: string) => {
  const dep = watchedFiles.get(changedPath);
  if (dep) {
    // 调用 reload() 方法
    const newDep = await dep.reload();
    // 更新文件映射
    watchedFiles.set(newDep.filePath, newDep);
  }
});
```

### 4. 自动清理

- 旧插件的 `onDispose` hooks 被调用
- 所有定时器（`setInterval`/`setTimeout`）自动清理
- 新插件重新挂载
- 新的定时器开始运行

## 🎯 关键特性

### ✅ 保留子依赖树

如果插件有子依赖，热重载会保留子依赖树：

```typescript
// parent-plugin.ts
import './child-plugin';  // 子插件

// 重载 parent-plugin 时，child-plugin 会被保留
```

### ✅ 自动清理副作用

```typescript
// 在插件中使用定时器
setInterval(() => {
  console.log('定时任务');
}, 1000);

// 热重载时自动清理，无需手动 clearInterval
```

### ✅ 类型安全

```typescript
// 重载后返回新的 Dependency 实例
const newDep: Dependency = await dep.reload();

// 如果使用自定义类
class MyPlugin extends Dependency { }
const newPlugin: MyPlugin = await plugin.reload();
```

## 📝 最佳实践

### 1. 使用版本号追踪

```typescript
const VERSION = 1;  // 每次修改时更新

console.log(`[Plugin v${VERSION}] ...`);
```

### 2. 在 onDispose 中记录状态

```typescript
onDispose(() => {
  console.log(`已执行 ${counter} 次任务`);
  console.log('当前状态:', someState);
});
```

### 3. 错误处理

```typescript
try {
  const newDep = await dep.reload();
} catch (error) {
  console.error('重载失败:', error);
  // 继续使用旧的 dep
}
```

### 4. 稳定性配置

```typescript
// 等待文件写入完成，避免读取不完整的文件
awaitWriteFinish: {
  stabilityThreshold: 300,
  pollInterval: 100
}
```

## 🐛 常见问题

### Q: 为什么修改后没有自动重载？

**A:** 检查以下几点：
1. 文件是否在监听列表中
2. 文件修改是否已保存
3. 检查控制台是否有错误信息
4. 确认 `awaitWriteFinish` 配置

### Q: 热重载后状态丢失了？

**A:** 这是正常的。热重载会创建新的插件实例，旧的状态不会保留。如果需要保留状态，考虑：
- 将状态存储在外部（文件、数据库）
- 使用持久化存储
- 在 onDispose 中导出状态，在 onMount 中恢复

### Q: 定时器没有被清理？

**A:** 确保：
1. 副作用包装功能已启用（默认启用）
2. 没有设置 `DEPENDENCY_WRAP_EFFECTS=false`
3. 使用全局的 `setInterval`/`setTimeout`

### Q: 可以同时监听多个文件吗？

**A:** 可以！系统会自动监听所有依赖文件。你也可以手动添加：

```typescript
watcher.add([
  './plugins/plugin1.ts',
  './plugins/plugin2.ts'
]);
```

## 🎓 进阶用法

### 1. 条件重载

```typescript
watcher.on('change', async (path) => {
  // 只在特定条件下重载
  if (shouldReload(path)) {
    await dep.reload();
  }
});
```

### 2. 批量重载

```typescript
let reloadTimer: NodeJS.Timeout;

watcher.on('change', (path) => {
  // 防抖：避免短时间内多次重载
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    await dep.reload();
  }, 500);
});
```

### 3. 重载通知

```typescript
root.on('after-reload', (dep) => {
  // 发送通知
  notify(`${dep.name} 已重载`);
  
  // 记录日志
  logger.info(`Plugin reloaded: ${dep.name}`);
});
```

## 📚 相关文档

- [主文档 - 热重载](../packages/dependency/README.md#-热重载)
- [API 文档](../packages/dependency/README.md#-api-文档)
- [生命周期](../packages/dependency/README.md#-生命周期)

## 🤝 反馈

如果遇到问题或有建议，欢迎提交 Issue！

