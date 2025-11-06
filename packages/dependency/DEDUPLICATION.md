# 依赖去重功能

## 📋 功能概述

实现了依赖去重机制，确保同一个模块在依赖树中只有一个实例，即使被多个模块引用。

## 🎯 核心设计

### 关键概念

#### 1. **Parent（父节点）**
- **定义**：第一个导入该依赖的模块
- **特点**：
  - 只有一个 parent
  - parent **不在** refs 中
  - 负责依赖的主要生命周期管理

#### 2. **Refs（引用者集合）**
- **定义**：后续导入该依赖的所有模块
- **特点**:
  - 可以有多个 refs
  - parent 不包含在 refs 中
  - 用于事件冒泡和引用计数

#### 3. **Global Dependency Pool（全局依赖池）**
- **定义**：存储所有唯一依赖实例的映射表
- **Key**：标准化的文件绝对路径
- **Value**：Dependency 实例

### 总引用数计算

```typescript
totalRefs = (parent ? 1 : 0) + refs.size
```

- 如果有 parent，计为 1 个引用
- refs.size 为后续导入者数量
- 总引用数 = parent 引用 + refs 引用

## 🔧 实现细节

### 1. 导入逻辑 (`importChild`)

```typescript
async importChild(importPath: string): Promise<Dependency> {
  const normalizedPath = this.resolveFilePath(absolutePath);
  let child = Dependency.globalDepMap.get(normalizedPath);

  if (child) {
    // 已存在：二次导入，加入 refs
    child.refs.add(this);
    this.children.push(child);
  } else {
    // 不存在：首次导入，设置 parent
    child = new Dependency(normalizedPath);
    child.parent = this;
    this.children.push(child);
    Dependency.globalDepMap.set(normalizedPath, child);
    
    if (this.started) {
      await child.start();
    }
  }

  return child;
}
```

**关键点**：
- 首次导入：设置 `parent`，不加入 `refs`
- 后续导入：加入 `refs`，不修改 `parent`
- 后续导入不会重复 `start()`

### 2. 停止逻辑 (`stop`)

```typescript
async stop(): Promise<void> {
  // ... 省略前置逻辑

  for (const child of this.children) {
    if (this === child.parent) {
      // 当前是 parent，需要转移 parent
      child.parent = null;
      if (child.refs.size > 0) {
        // 提升一个 ref 为新 parent
        const newParent = Array.from(child.refs)[0];
        child.parent = newParent;
        child.refs.delete(newParent);
      }
    } else {
      // 当前是 refs 之一
      child.refs.delete(this);
    }
    
    // 如果没有任何引用了，真正停止并清理
    if (child.parent === null && child.refs.size === 0) {
      await child.stop();
      Dependency.globalDepMap.delete(child.filePath);
    }
  }

  // ... 省略后续逻辑
}
```

**关键点**：
- 如果停止的是 parent：
  - 将 parent 置为 null
  - 如果有 refs，提升第一个 ref 为新 parent
  - 被提升的 ref 从 refs 中移除
- 如果停止的是 ref：
  - 从 refs 中移除当前节点
- 只有当 `parent === null && refs.size === 0` 时才真正停止和清理

### 3. 事件冒泡 (`dispatchAsync`)

```typescript
async dispatchAsync(event: string, ...args: any[]): Promise<void> {
  // 向 parent 和所有 refs 冒泡
  const targets = new Set<Dependency>();
  
  if (this.parent) {
    targets.add(this.parent);
  }
  
  for (const ref of this.refs) {
    targets.add(ref);
  }
  
  if (targets.size > 0) {
    // 向所有引用者冒泡
    for (const target of targets) {
      await target.dispatchAsync(event, ...args);
    }
  } else {
    // 根节点，向下广播
    await this.broadcastAsync(event, ...args);
  }
}
```

**关键点**：
- 事件同时向 parent 和所有 refs 冒泡
- 如果既没有 parent 也没有 refs，说明是根节点，改为向下广播

### 4. 根节点判断 (`isRoot`)

```typescript
isRoot(): boolean {
  return this.parent === null;
}
```

**注意**：
- 根节点 = `parent === null`
- 不是 `refs.size === 0`
- 一个节点可以有 refs 但仍然是根节点（如果它没有 parent）

### 5. 树形打印增强 (`printTree`)

```typescript
printTree(): string {
  const totalRefs = (this.parent ? 1 : 0) + this.refs.size;
  const sharedMark = totalRefs > 1 ? ` [shared ×${totalRefs}]` : '';
  
  let result = prefix + `${this.name} (${totalListeners} listeners)${sharedMark}\n`;
  // ...
}
```

**效果**：
```
a (1 listeners)
├── b (1 listeners)
│   └── c (1 listeners)
│       └── d (2 listeners) [shared ×2]
└── d (2 listeners) [shared ×2]
```

## 📊 示例场景

### 场景：a → b, a → d, b → c, c → d

#### 初始状态

```typescript
// 执行顺序：
// 1. a 导入 b （首次）
//    - b.parent = a
//    - b.refs = Set()

// 2. a 导入 d （首次）
//    - d.parent = a
//    - d.refs = Set()

// 3. b 导入 c （首次）
//    - c.parent = b
//    - c.refs = Set()

// 4. c 导入 d （二次）
//    - d.parent = a （保持不变）
//    - d.refs = Set([c]) （c 加入）
```

**结果**：
- `d.parent = a`（首次导入者）
- `d.refs = Set([c])`（后续导入者）
- 总引用数 = 1 (parent) + 1 (refs) = 2

#### 停止 b（包括 c）

```typescript
await b.stop();

// 处理 b 的子依赖 c：
//   - c.parent = b，所以 b 是 parent
//   - c.parent = null
//   - c.refs.size = 0，所以真正停止 c

// 处理 c 的子依赖 d：
//   - c 不是 d.parent（d.parent = a）
//   - c 在 d.refs 中，所以从 d.refs 中移除
//   - d.refs = Set()（清空）
//   - d.parent = a（仍然存在），所以 d 不停止
```

**结果**：
- `c` 被真正停止（parent 和 refs 都为空）
- `d` 继续运行（还有 parent = a）
- `d.refs = Set()`（c 已移除）

#### 停止 a

```typescript
await a.stop();

// 处理 a 的子依赖 b：
//   - b.parent = a，所以需要转移 parent
//   - b.parent = null
//   - b.refs.size = 0，所以真正停止 b

// 处理 a 的子依赖 d：
//   - d.parent = a，所以需要转移 parent
//   - d.parent = null
//   - d.refs.size = 0，所以真正停止 d
//   - 从 globalDepMap 中删除 d
```

**结果**：
- `b` 被真正停止
- `d` 被真正停止（没有任何引用了）
- `d` 从全局依赖池中移除

## ✅ 测试验证

完整测试用例位于：`examples/dependency/src/test-deduplication.ts`

### 测试覆盖：

1. ✅ **实例唯一性**：验证 `d_from_a === d_from_c`
2. ✅ **Refs 大小**：验证 `d.refs.size === 1`
3. ✅ **Parent 正确性**：验证 `d.parent === a`
4. ✅ **Refs 内容**：验证 `c` 在 `d.refs` 中
5. ✅ **总引用数**：验证总引用数 = 2
6. ✅ **部分停止**：验证停止 b 后，d 继续运行
7. ✅ **Refs 清理**：验证停止 b 后，d.refs 清空
8. ✅ **Parent 保持**：验证停止 b 后，d.parent 仍然是 a
9. ✅ **完全停止**：验证停止 a 后，d 也停止

### 运行测试：

```bash
pnpm run test:dedup
```

## 🔍 关键逻辑验证

### Parent 和 Refs 的互斥性

✅ **正确**：
- Parent **不在** refs 中
- 首次导入 → parent
- 后续导入 → refs
- Parent 停止 → 提升 ref 为新 parent → 从 refs 中移除

❌ **错误**：
- Parent 同时在 refs 中
- 所有导入者都在 refs 中
- Parent 停止后不处理 parent 转移

### 引用计数和清理

✅ **正确**：
- `totalRefs = (parent ? 1 : 0) + refs.size`
- 删除条件：`parent === null && refs.size === 0`
- Parent 停止时转移 parent 给 refs

❌ **错误**：
- 只检查 `refs.size === 0`
- 只检查 `parent === null`
- 直接删除依赖而不检查引用

## 🎉 优势

1. **内存优化**：同一模块只有一个实例
2. **状态一致性**：共享模块的状态在所有引用者之间一致
3. **正确的生命周期**：只有在所有引用者都停止后才真正清理
4. **灵活的事件系统**：事件可以向所有引用者冒泡

## 🔄 热重载支持

### 重载时的 Refs 处理

在热重载场景下，需要特别处理 `refs` 和 `parent` 的清理和恢复：

#### 1. 保存旧 Children 并重新导入（Clone-Diff-Merge 策略）

```typescript
async #reloadNode(isRoot: boolean): Promise<Dependency<P>> {
  if (isRoot) {
    // 1. Clone: 保存旧的 children
    const savedChildren = [...this.children];
    
    // 2. 清理引用关系
    for (const child of savedChildren) {
      if (this === child.parent) {
        child.parent = null;
      } else {
        child.refs.delete(this);
      }
    }
    
    // 3. 重新导入
    this.children = [];
    await this.start(); // 重新执行模块代码，构建新的 children
    
    // 4. Diff: 比较新旧 children
    const newChildren = this.children;
    const keptChildren: P[] = [];
    const removedChildren: P[] = [];
    
    for (const savedChild of savedChildren) {
      if (newChildren.find(c => c.filePath === savedChild.filePath)) {
        // 保留的：复用旧实例，保持状态
        keptChildren.push(savedChild);
        savedChild.parent = this; // 恢复引用
      } else {
        // 被移除的
        removedChildren.push(savedChild);
      }
    }
    
    const addedChildren = newChildren.filter(newChild =>
      !savedChildren.find(c => c.filePath === newChild.filePath)
    );
    
    // 5. 清理被移除的
    for (const child of removedChildren) {
      await this.#cleanupRemovedChild(child);
    }
    
    // 6. Merge: 用旧实例替换新实例
    this.children = [...keptChildren, ...addedChildren];
    
    return this;
  }
}
```

**清理被移除子依赖的逻辑**：
```typescript
async #cleanupRemovedChild(child: Dependency): Promise<void> {
  // 递归清理孙子依赖
  for (const grandchild of [...child.children]) {
    if (grandchild.parent === child) {
      grandchild.parent = null;
    } else {
      grandchild.refs.delete(child);
    }
    
    // 只有在孙子依赖完全没有引用时，才停止它并递归清理其子树
    if (grandchild.parent === null && grandchild.refs.size === 0) {
      await grandchild.stop();
      Dependency.globalDepMap.delete(grandchild.filePath);
      // 递归清理孙子的子树
      await this.#cleanupRemovedChild(grandchild);
    }
    // 关键：如果孙子依赖还有其他引用（parent 或 refs），不清理其子树
    // 因为它还在被其他模块使用
  }
  
  child.children = [];
  
  if (child.parent === null && child.refs.size === 0) {
    await child.stop();
    Dependency.globalDepMap.delete(child.filePath);
  }
}
```

**关键点（Clone-Diff-Merge 策略）**：
1. **Clone**：保存旧的 children 列表
2. **Dispose & Reimport**：清理引用、重新导入模块、构建新 children
3. **Diff**：比较新旧 children
   - **Kept**（保留的）：复用旧实例，保持状态（listeners、refs等）
   - **Removed**（被移除的）：递归清理子树，stop 并从全局池删除
   - **Added**（新增的）：使用新实例
4. **Merge**：用旧实例替换新实例（kept + added）
5. **优势**：避免重复注册钩子，保持依赖状态不变

#### 2. 恢复引用关系（重新导入时）

在 `importChild` 中，当从全局池中复用已存在的依赖时：

```typescript
if (child) {
  // 已存在：检查是否需要恢复 parent 或加入 refs
  if (child.parent === null) {
    // 没有 parent（可能是重载后被清空），恢复 parent
    child.parent = this;
    // 关键修复：清理 refs，确保 this 不在 refs 中
    // 因为重载前 this 可能是 ref，现在变成 parent 了
    child.refs.delete(this);
  } else if (child.parent !== this) {
    // 已有不同的 parent，这是真正的二次导入，加入 refs
    child.refs.add(this);
  }
  // 如果 child.parent === this，说明已经是正确的引用关系，无需操作
  
  // 添加到 children 列表（避免重复）
  if (!this.children.includes(child)) {
    this.children.push(child);
  }
}
```

**关键点**：
- 如果 `child.parent === null`，说明这是重载恢复，应该设置 `parent`，并清理 `refs` 中的 `this`
- 如果 `child.parent !== null && child.parent !== this`，说明这是真正的多次导入，应该加入 `refs`
- **重要修复**：恢复 parent 时，必须同时 `child.refs.delete(this)`，避免 refs 残留导致错误的 `[shared ×N]` 标记

#### 3. 跳过共享依赖的重复启动（start 阶段）

```typescript
// 在 start() 方法中，遍历 children 启动时
for (const child of this.children) {
  // 如果子依赖不在全局池中，或者在全局池中但 parent 是当前节点（首次导入），则启动
  const existingChild = Dependency.globalDepMap.get(child.filePath);
  if (!existingChild || existingChild.parent === this) {
    await child.start();
  }
}
```

**关键点**：
- 重载时重新 `importChild()` 会返回已存在的共享依赖
- 这些共享依赖已经 started 和 mounted
- **不应该再次调用 `start()`**，否则会触发副作用重复（虽然有 `if (this.started) return` 保护，但重新 `import()` 模块会重复注册钩子）
- 只有首次导入（`existingChild.parent === this`）或新创建的依赖（`!existingChild`）才需要 start

### 测试验证

完整的重载测试用例位于：`examples/dependency/src/test-reload-refs.ts`

测试覆盖：
1. ✅ 重载前后实例一致性
2. ✅ 重载后 parent 正确恢复
3. ✅ 重载后 refs 不会重复
4. ✅ 重载后总引用数保持正确

运行测试：
```bash
pnpm run test:reload-refs
```

## 📝 注意事项

1. **导入顺序影响 Parent**：第一个导入者成为 parent，后续导入者成为 refs
2. **Parent 转移**：当 parent 停止时，会从 refs 中提升一个作为新 parent
3. **测试时使用顶层 await**：确保 `importChild` 在模块加载阶段执行，而不是在 `mount` 阶段
4. **事件冒泡**：事件会向 parent 和所有 refs 冒泡，确保所有引用者都能收到通知
5. **热重载**：重载时必须正确清理和恢复引用关系，避免 refs 重复计数

