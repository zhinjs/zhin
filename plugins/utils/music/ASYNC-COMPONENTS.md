# Zhin 异步组件使用指南

## 概述

Zhin 现在支持类似 Next.js 的异步组件，让你可以在组件中执行异步操作（如 API 调用、数据库查询等）。

## 基础用法

### 1. 定义异步组件

```tsx
import { addComponent } from "zhin.js";

// 异步组件 - 使用 async function
async function UserCard({ userId }: { userId: string }) {
  // 可以在组件内部执行异步操作
  const user = await fetchUser(userId);
  
  return `👤 ${user.name} (${user.email})`;
}

// 注册组件
addComponent(UserCard);
```

### 2. 使用异步组件

#### 方式 A：在命令 action 中直接调用（推荐）

```tsx
addCommand(
  new MessageCommand("用户信息 <userId:text>")
    .action(async (message, result) => {
      const userId = result.params.userId;
      
      // 直接调用异步组件
      return await UserCard({ userId });
    })
);
```

#### 方式 B：在其他异步组件中调用

```tsx
async function UserProfile({ userId }: { userId: string }) {
  // 在异步组件中调用其他异步组件
  const cardContent = await UserCard({ userId });
  
  return `个人资料\n${cardContent}`;
}
```

## 高级用法

### 使用 Suspense 包装器

`Suspense` 组件可以为异步组件提供加载提示和错误处理：

```tsx
import { defineComponent, addComponent } from "zhin.js";

const Suspense = defineComponent(async function Suspense(
  props: { fallback?: string; children?: any }
) {
  try {
    // 等待异步内容加载
    if (props.children && typeof props.children?.then === 'function') {
      return await props.children;
    }
    return props.children || '';
  } catch (error) {
    return props.fallback || '加载失败';
  }
}, 'Suspense');

addComponent(Suspense);

// 使用
addCommand(
  new MessageCommand("获取数据")
    .action(async () => {
      return await Suspense({
        fallback: "正在加载...",
        children: fetchData()
      });
    })
);
```

### 并行加载多个异步组件

```tsx
async function Dashboard() {
  // 并行加载多个组件
  const [users, stats, messages] = await Promise.all([
    UserList(),
    Statistics(),
    RecentMessages()
  ]);
  
  return `📊 仪表盘\n\n${users}\n\n${stats}\n\n${messages}`;
}
```

## 实际示例：音乐分享组件

```tsx
import { addComponent, defineComponent } from "zhin.js";
import { musicServices } from "./sources/index.js";
import { sourceConfigMap } from "./config.js";

// 异步组件：分享音乐
async function ShareMusic({ 
  platform, 
  musicId 
}: { 
  platform: 'qq' | 'netease', 
  musicId: string 
}) {
  // 异步获取音乐详情
  const service = musicServices[platform];
  if (!service) return 'unsupported music source';
  
  const { id, source, ...detail } = await service.getDetail(musicId);
  
  // 返回 JSX 元素
  return <share {...detail} config={sourceConfigMap[platform]} />
}

addComponent(ShareMusic);

// 在命令中使用
addCommand(
  new MessageCommand("点歌 <keyword:text>")
    .action(async (message, result) => {
      // ... 搜索逻辑
      
      // 直接调用异步组件
      return await ShareMusic({ 
        platform: 'netease', 
        musicId: '12345' 
      });
    })
);
```

## 最佳实践

### 1. 错误处理

始终在异步组件中处理可能的错误：

```tsx
async function SafeComponent({ id }: { id: string }) {
  try {
    const data = await fetchData(id);
    return formatData(data);
  } catch (error) {
    console.error('Component error:', error);
    return '❌ 加载失败，请稍后重试';
  }
}
```

### 2. 加载状态

对于耗时操作，提供友好的加载提示：

```tsx
addCommand(
  new MessageCommand("查询 <id:text>")
    .action(async (message, result) => {
      // 先发送加载提示
      await message.$reply("正在查询，请稍候...");
      
      // 然后执行异步操作
      const data = await fetchData(result.params.id);
      return formatData(data);
    })
);
```

### 3. 性能优化

使用 `Promise.all` 并行加载多个数据源：

```tsx
async function CombinedData({ keyword }: { keyword: string }) {
  // ❌ 串行加载（慢）
  // const qq = await searchQQ(keyword);
  // const netease = await searchNetease(keyword);
  
  // ✅ 并行加载（快）
  const [qq, netease] = await Promise.all([
    searchQQ(keyword),
    searchNetease(keyword)
  ]);
  
  return [...qq, ...netease];
}
```

## 与 Next.js 的对比

| 特性 | Next.js | Zhin |
|------|---------|------|
| 异步组件 | `async function Component()` | `async function Component()` ✅ |
| Server Components | 默认支持 | N/A（消息机器人场景） |
| Suspense | `<Suspense>` | 需手动实现 |
| 错误边界 | `error.js` | `try-catch` |
| 流式渲染 | 支持 | 不支持 |

## 注意事项

1. **异步组件必须在 async context 中调用**
   - ✅ 在命令的 `action` 中（async）
   - ✅ 在其他异步组件中
   - ❌ 在同步函数中

2. **JSX 语法限制**
   - 目前不支持直接在 JSX 中使用 `<AsyncComponent />`
   - 需要使用函数调用：`await AsyncComponent(props)`

3. **类型安全**
   - 为组件 props 定义 TypeScript 接口
   - 使用泛型确保类型推断正确

## 未来改进

计划中的功能：

- [ ] 支持 `<Component />` JSX 语法直接渲染异步组件
- [ ] 内置 `<Suspense>` 组件
- [ ] 错误边界组件
- [ ] 组件缓存机制

---

**更多信息**：参考 [Zhin 文档](../README.md)
