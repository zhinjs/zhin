# 事件冒泡调试指南

## 问题描述

用户报告：
1. **重载时 `before-stop` 事件没有冒泡到根节点**
2. **新增节点 `started` 事件没有冒泡到根节点**

## 事件冒泡机制

### dispatchAsync 流程

```typescript
async dispatchAsync(event: string, ...args: any[]): Promise<void> {
  if (this.parent) await this.parent.dispatchAsync(event, ...args);  // 向上冒泡
  else await this.broadcastAsync(event, ...args);  // 到达根节点后广播
}

async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  this.emitAsync(event, ...args);  // 自己 emit
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);  // 递归广播给子节点
  }
}
```

**流程**：
1. 子节点触发事件 → `dispatchAsync`
2. 检查是否有 `parent`
3. 如果有，向上冒泡到 `parent.dispatchAsync`
4. 递归直到根节点（没有 parent）
5. 根节点调用 `broadcastAsync`，向下广播给所有子节点

## 测试场景

### 场景 1：根节点 reload，子节点被移除

```
Root (reload)
  └─ ChildA (被移除) → stop()
```

**预期流程**：
1. `ChildA.stop()` 触发 `before-stop`
2. `ChildA.dispatchAsync('before-stop', ChildA)`
3. `ChildA.parent` = Root
4. `Root.dispatchAsync('before-stop', ChildA)`
5. Root 没有 parent
6. `Root.broadcastAsync('before-stop', ChildA)`
7. `Root.emitAsync('before-stop', ChildA)` ✅ **根节点监听器应该被触发**

### 场景 2：子节点 reload，孙节点被移除

```
Root
  └─ Child (reload)
       └─ GrandChild (被移除) → stop()
```

**预期流程**：
1. `GrandChild.stop()` 触发 `before-stop`
2. `GrandChild.parent` = 旧的 Child
3. 旧的 Child.`dispatchAsync('before-stop', GrandChild)`
4. 旧的 Child.`parent` = Root
5. `Root.dispatchAsync('before-stop', GrandChild)`
6. `Root.broadcastAsync('before-stop', GrandChild)`
7. ✅ **根节点监听器应该被触发**

### 场景 3：新增子节点启动

```
Root (reload)
  └─ NewChild (新增) → start()
```

**预期流程**：
1. Root reload，重新导入模块
2. `NewChild` 通过 `importChild` 创建
3. 在 `start()` 的第 97-99 行，遍历 children 并 start
4. `NewChild.start()` 完成后触发 `started`
5. `NewChild.dispatchAsync('started', NewChild)`
6. `NewChild.parent` = Root
7. `Root.dispatchAsync('started', NewChild)`
8. `Root.broadcastAsync('started', NewChild)`
9. ✅ **根节点监听器应该被触发**

## 可能的问题

### 问题 1：parent 引用丢失

**症状**：事件无法向上冒泡

**原因**：某个节点的 `parent` 属性被清空或设置为错误的值

**排查**：
```typescript
root.on('before-stop', (dep) => {
  console.log(`[ROOT] before-stop: ${dep.name}, parent: ${dep.parent?.name || 'null'}`);
});
```

### 问题 2：事件名称不匹配

**症状**：监听器没有被触发

**原因**：事件名称拼写错误或使用了错误的事件名

**排查**：
```typescript
// 检查所有事件
root.on('before-stop', (dep) => console.log('before-stop', dep.name));
root.on('stopped', (dep) => console.log('stopped', dep.name));
root.on('started', (dep) => console.log('started', dep.name));
root.on('before-start', (dep) => console.log('before-start', dep.name));
```

### 问题 3：使用了同步 dispatch

**症状**：某些事件无法正确冒泡

**原因**：代码中混用了 `dispatch()` 和 `dispatchAsync()`

**已修复**：
- ✅ 第 110 行：`started` 事件改用 `dispatchAsync`

**仍需检查**：
- 第 102 行：`error` 事件使用同步 `dispatch`（但这通常是期望的行为）
- 第 327-328 行：错误处理中使用同步 `dispatch`（也是期望的行为）

### 问题 4：broadcastAsync 未await

**症状**：事件广播不完整

**原因**：`broadcastAsync` 中的 `emitAsync` 没有 await

**检查**：
```typescript
async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  this.emitAsync(event, ...args);  // ⚠️  这里没有 await！
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);
  }
}
```

**修复**：
```typescript
async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  await this.emitAsync(event, ...args);  // ✅ 添加 await
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);
  }
}
```

## 调试步骤

### 1. 添加详细日志

```typescript
// 在 dispatchAsync 中添加日志
async dispatchAsync(event: string, ...args: any[]): Promise<void> {
  console.log(`[DISPATCH] ${this.name}: ${event}, has parent: ${!!this.parent}`);
  if (this.parent) await this.parent.dispatchAsync(event, ...args);
  else await this.broadcastAsync(event, ...args);
}

// 在 broadcastAsync 中添加日志
async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  console.log(`[BROADCAST] ${this.name}: ${event}, children: ${this.children.length}`);
  await this.emitAsync(event, ...args);
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);
  }
}
```

### 2. 监听所有相关事件

```typescript
const events = [
  'before-start', 'started',
  'before-mount', 'mounted',
  'before-dispose', 'disposed',
  'before-stop', 'stopped',
  'before-reload', 'reloading', 'reloaded'
];

events.forEach(event => {
  root.on(event, (dep) => {
    console.log(`[EVENT] ${event}: ${dep.name}`);
  });
});
```

### 3. 检查依赖树结构

```typescript
function printTree(dep: Dependency, indent = '') {
  console.log(`${indent}${dep.name} (parent: ${dep.parent?.name || 'null'})`);
  dep.children.forEach(child => printTree(child, indent + '  '));
}

// reload 前
console.log('=== Before Reload ===');
printTree(root);

// reload 后
console.log('=== After Reload ===');
printTree(root);
```

## 已修复的问题

### ✅ started 事件使用 dispatchAsync

**位置**：`src/dependency.ts:110`

**修改**：
```typescript
// 修改前
await this.mount();
this.dispatch('started', this);  // ❌ 同步 dispatch

// 修改后
await this.mount();
await this.dispatchAsync('started', this);  // ✅ 异步 dispatchAsync
```

## 待修复的问题

### ⚠️  broadcastAsync 未 await emitAsync

**位置**：`src/dependency.ts:138`

**问题**：
```typescript
async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  this.emitAsync(event, ...args);  // ⚠️  没有 await
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);
  }
}
```

**影响**：
- 父节点的监听器可能在子节点的监听器之后执行
- 如果监听器中有错误，可能无法正确捕获

**修复**：添加 `await`

## 建议的完整修复

```typescript
// 1. broadcastAsync 添加 await
async broadcastAsync(event: string, ...args: any[]): Promise<void> {
  await this.emitAsync(event, ...args);  // ✅ 添加 await
  for (const child of this.children) {
    await child.broadcastAsync(event, ...args);
  }
}

// 2. 确保所有需要冒泡的事件都使用 dispatchAsync
// 已检查：所有生命周期事件都使用 dispatchAsync ✅
```

## 测试用例

```typescript
import { Dependency } from '@zhin.js/dependency';

// 测试：reload 时 before-stop 事件冒泡
async function testBeforeStopBubbling() {
  const root = new Dependency('./test-root.ts');
  
  let eventReceived = false;
  root.on('before-stop', (dep) => {
    eventReceived = true;
    console.log(`✅ Received before-stop event from ${dep.name}`);
  });
  
  await root.start();
  const child = root.children[0];
  
  // reload root，child 会被移除并 stop
  await root.reload();
  
  if (eventReceived) {
    console.log('✅ Test passed: before-stop event bubbled to root');
  } else {
    console.error('❌ Test failed: before-stop event did NOT bubble to root');
  }
}

// 测试：新增节点 started 事件冒泡
async function testStartedBubbling() {
  const root = new Dependency('./test-root.ts');
  
  const receivedEvents: string[] = [];
  root.on('started', (dep) => {
    receivedEvents.push(dep.name);
    console.log(`✅ Received started event from ${dep.name}`);
  });
  
  await root.start();
  
  if (receivedEvents.length > 0) {
    console.log(`✅ Test passed: received ${receivedEvents.length} started events`);
    console.log(`   Events: ${receivedEvents.join(', ')}`);
  } else {
    console.error('❌ Test failed: no started events received');
  }
}
```

