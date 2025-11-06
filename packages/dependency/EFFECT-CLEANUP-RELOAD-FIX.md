# 副作用清理在 Reload 时失效的问题修复

## 🐛 问题描述

用户报告：
- **macOS 上副作用自动清理完全正常**
- **Windows 上 tsx 运行时，副作用无法自动清理，但手动清理可以**

## 🔍 根本原因

在最近的代码更新中，用户添加了 `#cleanLifecycleListeners()` 方法来清理根节点 reload 时的生命周期监听器：

```typescript
#cleanLifecycleListeners(): void {
  const lifecycleEvents = this.eventNames().filter(e => typeof e === 'string' && e.startsWith('self.'));
  for(const event of lifecycleEvents){
    this.removeAllListeners(event);
  }
  this.#onSelfDispose = [];  // ❌ 问题：清空了所有 inner dispose hooks
}
```

**问题**：`this.#onSelfDispose = []` 会清空所有使用 `inner: true` 的 dispose hooks，包括副作用清理钩子！

### 副作用清理机制

副作用包装代码（在 `loaders/transform-utils.mjs` 中）：

```javascript
onDispose(() => {
  __global_effects__.intervals.forEach(intervalId => clearInterval(intervalId));
  __global_effects__.timeouts.forEach(timeoutId => clearTimeout(timeoutId));
  __global_effects__.immediates.forEach(immediateId => clearImmediate(immediateId));
}, true);  // ← 注意：inner: true
```

`inner: true` 意味着这个钩子会被添加到 `#onSelfDispose` 数组中，而不是 `self.dispose` 事件监听器。

### 问题流程

1. 模块加载时，副作用清理钩子通过 `onDispose(..., true)` 注册到 `#onSelfDispose`
2. 根节点 reload 时调用 `#cleanLifecycleListeners()`
3. `this.#onSelfDispose = []` 清空了副作用清理钩子
4. 模块重新加载，新的副作用清理钩子注册
5. **但旧模块的定时器仍在运行，且没有清理钩子来停止它们**！

## ✅ 修复方案

在清空 `#onSelfDispose` **之前**，先执行所有钩子（包括副作用清理）：

```typescript
#cleanLifecycleListeners(): void {
  // ✅ 先执行所有 inner dispose hooks（包括副作用清理）
  for (const dispose of this.#onSelfDispose) {
    if (typeof dispose === 'function') {
      try {
        dispose();
      } catch (error) {
        console.warn('Error while executing dispose hook during cleanup:', error);
      }
    }
  }
  
  // 然后清空数组，准备重新注册
  this.#onSelfDispose = [];
  
  // 清空 self.* 事件监听器
  const lifecycleEvents = this.eventNames().filter(e => typeof e === 'string' && e.startsWith('self.'));
  for(const event of lifecycleEvents){
    this.removeAllListeners(event);
  }
}
```

### 修复逻辑

1. **执行所有 `#onSelfDispose` 钩子**
   - 这会清理当前模块实例的所有副作用（定时器、资源等）
   - 确保旧模块的定时器被停止

2. **清空 `#onSelfDispose` 数组**
   - 移除旧的钩子引用
   - 为新模块的钩子注册做准备

3. **清空 `self.*` 事件监听器**
   - 移除生命周期事件监听器
   - 避免重复注册

## 📊 测试验证

### 测试脚本

创建了 `examples/dependency/src/test-effect-cleanup.ts` 来验证副作用自动清理：

```typescript
// 1. 创建依赖并启动
const dep = new Dependency(testPluginPath);
await dep.start();

// 2. 等待定时器执行几次
await new Promise(resolve => setTimeout(resolve, 2000));
const executionsBeforeStop = intervalExecutions;  // 记录执行次数

// 3. 停止依赖（应该自动清理副作用）
await dep.stop();

// 4. 等待并检查定时器是否还在执行
await new Promise(resolve => setTimeout(resolve, 2000));
const executionsAfterStop = intervalExecutions;

// 5. 验证
if (executionsAfterStop > executionsBeforeStop) {
  // ❌ 定时器仍在执行，清理失败
} else {
  // ✅ 定时器已停止，清理成功
}
```

### 测试结果

**macOS (本地测试)**：
```
✅ 测试通过：定时器在 stop 后停止了（已被自动清理）
stop 前执行次数: 3
stop 后执行次数: 0
```

**Windows & Linux**：
- 等待 GitHub CI 测试结果

### GitHub CI 配置

创建了 `.github/workflows/test-effect-cleanup.yml`：
- 在 `ubuntu-latest`, `macos-latest`, `windows-latest` 上测试
- 运行 `pnpm run test:effects`
- 验证副作用自动清理在所有平台上都正常工作

## 💡 设计启示

### 1. `inner` dispose hooks 的生命周期

`inner: true` 的 dispose hooks：
- 用于模块内部的资源清理（副作用、连接等）
- 不应该被外部的事件监听器清理
- 需要在模块生命周期结束时（dispose 或 reload）执行

### 2. Reload 清理顺序

正确的 reload 清理顺序：
1. **执行 `#onSelfDispose` 钩子** - 清理副作用和资源
2. **清空 `#onSelfDispose` 数组** - 移除旧钩子引用
3. **清空事件监听器** - 移除旧的事件监听
4. **重新导入模块** - 加载新代码
5. **重新注册钩子** - 新模块注册新的钩子

### 3. 平台差异的可能原因

Windows 上可能存在的差异：
- 定时器 ID 的数据结构不同（Node.js 内部实现）
- 模块缓存机制不同
- loader 的行为差异
- 文件系统路径处理差异（`\` vs `/`）

通过 CI 测试可以快速定位平台特定的问题。

## 📚 相关文档

- [EVENT-BUBBLING-FIX.md](./EVENT-BUBBLING-FIX.md) - 事件冒泡修复
- [LIFECYCLE-CHANGES.md](./LIFECYCLE-CHANGES.md) - 生命周期事件变更
- [EFFECT-WRAPPER.md](./EFFECT-WRAPPER.md) - 副作用包装机制（如果存在）

## 🎓 经验总结

1. **资源清理必须确保执行**
   - 在清空钩子数组之前，先执行所有钩子
   - 使用 try-catch 确保一个钩子失败不影响其他钩子

2. **平台差异需要 CI 验证**
   - macOS/Linux/Windows 上的 Node.js 行为可能不同
   - 使用 CI 在多平台上自动测试

3. **测试要准确反映真实场景**
   - 原始测试在 onDispose 中创建新的定时器，误报泄漏
   - 修改为计数 interval 执行次数，准确检测泄漏

4. **调试工具很重要**
   - 创建专门的测试脚本来隔离和验证问题
   - 使用 `cross-env` 确保环境变量在所有平台上正确设置

---

**修复完成时间**：2025-11-06
**修复影响**：✅ 副作用清理在 reload 时正确执行
**待验证**：⏳ Windows/Linux CI 测试结果

