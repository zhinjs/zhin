# 运行示例

## 📦 安装

在 example 目录下安装依赖：

```bash
cd packages/dependency/example
pnpm install
```

## 🚀 运行

### 方式 1: 使用 tsx (推荐)

```bash
pnpm dev
```

### 方式 2: 使用 Bun

```bash
pnpm dev:bun
```

### 方式 3: 禁用副作用包装

```bash
pnpm dev:no-wrap
```

## 📊 预期输出

运行示例后，你将看到以下输出：

### 1. 初始化阶段

```
============================================================
🌲 @zhin.js/dependency 完整示例
============================================================

📦 准备加载以下插件:
   1. logger-plugin.ts
   2. timer-plugin.ts
   3. database-plugin.ts
   4. parent-plugin.ts

🚀 启动所有插件...
```

### 2. 插件加载

每个插件会按顺序加载并输出日志：

```
📦 [Logger Plugin] 模块已加载
✅ [Lifecycle] logger-plugin 已启动
✅ [Logger Plugin] 插件已挂载
   版本: 1.0.0
✅ [Lifecycle] logger-plugin 已挂载

⏰ [Timer Plugin] 模块已加载
✅ [Lifecycle] timer-plugin 已启动
⚡ [Timer Plugin] 立即执行任务
✅ [Timer Plugin] 插件已挂载
🚀 [Timer Plugin] 所有定时器已注册（将自动清理）
✅ [Lifecycle] timer-plugin 已挂载
```

### 3. 定时任务执行

插件启动后，定时任务开始执行：

```
⏱️  [Timer Plugin] Tick #1
💾 [Database] 正在连接数据库...
✅ [Database] 数据库连接成功
📊 [Database] 执行查询 #1: SELECT * FROM users
🌟 [Parent Plugin] 父插件定时任务执行
💫 [Child Plugin] 子插件定时任务执行
```

### 4. 依赖树结构

显示所有插件的依赖树：

```
📊 依赖树结构:

logger-plugin (0 listeners)
timer-plugin (0 listeners)
database-plugin (0 listeners)
parent-plugin (0 listeners)
    └── child-plugin (0 listeners)
```

### 5. 优雅停止

10秒后，所有插件将优雅停止：

```
🛑 停止所有插件...

🛑 [Logger Plugin] 插件正在卸载
   总共记录了 0 条日志
🛑 [Database Plugin] 插件正在卸载
💾 [Database] 正在断开数据库连接...
📊 [Database] 总共执行了 5 次查询
🛑 [Parent Plugin] 父插件正在卸载
   子插件也会级联卸载
🛑 [Child Plugin] 子插件正在卸载

✅ 所有插件已停止
```

### 6. 清理验证

等待 2 秒验证所有定时器已被清理：

```
⏳ 等待 2 秒验证清理...

✅ 清理验证完成
   如果没有看到定时器继续执行，说明自动清理成功！

============================================================
🎉 示例演示完成！
============================================================
```

## 🎯 观察要点

### 1. 副作用自动清理

观察停止后是否还有定时器输出：

- ✅ **正确**: 停止后没有任何定时器继续执行
- ❌ **错误**: 停止后仍然看到定时器输出

### 2. 依赖树结构

注意 `parent-plugin` 和 `child-plugin` 的层级关系：

```
parent-plugin (0 listeners)
    └── child-plugin (0 listeners)
```

子插件正确嵌套在父插件下。

### 3. 级联停止

当父插件停止时，子插件也会自动停止：

```
🛑 [Parent Plugin] 父插件正在卸载
   子插件也会级联卸载
🛑 [Child Plugin] 子插件正在卸载
```

### 4. 生命周期事件

观察生命周期事件的触发顺序：

1. `after-start` - 模块已导入
2. `after-mount` - 挂载钩子已执行
3. 插件运行...
4. `dispose` - 卸载钩子执行
5. `stop` - 插件已停止

## 🔧 调试

### 启用详细日志

修改 `src/index.ts`，添加更多事件监听：

```typescript
root.on('before-start', (dep) => {
  console.log(`🔄 ${dep.name} 准备启动`);
});

root.on('before-mount', (dep) => {
  console.log(`🔄 ${dep.name} 准备挂载`);
});
```

### 禁用副作用包装测试

运行 `pnpm dev:no-wrap` 对比效果：

```bash
# 启用副作用包装（默认）
pnpm dev

# 禁用副作用包装
pnpm dev:no-wrap
```

禁用后，定时器不会自动清理，你会看到停止后仍有输出。

## 🐛 常见问题

### Q: 提示找不到模块

**A:** 确保在正确的目录下运行：

```bash
cd packages/dependency/example
pnpm install
```

### Q: TypeScript 错误

**A:** 确保父目录已编译：

```bash
cd packages/dependency
pnpm build
```

### Q: 定时器没有停止

**A:** 检查是否禁用了副作用包装：

```bash
# 确保使用默认配置
pnpm dev
```

## 📚 下一步

- 修改插件代码，观察热重载效果
- 尝试添加自定义插件
- 探索更多 API 和配置选项

查看 [README.md](./README.md) 了解更多详情。

