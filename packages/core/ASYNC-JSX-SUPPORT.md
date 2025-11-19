# 异步 JSX 组件支持

## 概述

Zhin Core 现在原生支持异步 JSX 组件，允许你像使用普通组件一样使用异步组件，无需额外的类型断言或注释。

## 核心改动

### 1. 类型系统扩展

**`packages/core/src/jsx.ts`**：
- 修改 `JSX.Element` 类型为联合类型，支持 `Promise<SendContent>`
- `renderJSX` 函数自动检测并 await Promise 返回值
- 错误时自动捕获并返回错误信息

**`packages/core/src/message.ts`**：
- `MessageComponent` 类型支持异步组件函数

### 2. 运行时支持

**自动 Promise 处理**：
```typescript
export async function renderJSX(element: MessageComponent<any>, context?: ComponentContext): Promise<SendContent> {
    try {
        // ... 组件渲染逻辑
        const result = await component(element.data, context || {} as ComponentContext);
        
        // 如果组件返回 Promise，自动 await
        if (result && typeof result === 'object' && 'then' in result) {
            return await result;
        }
        
        return result;
    } catch (error) {
        // 渲染错误时返回错误信息
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `❌ 组件渲染失败: ${errorMessage}`;
    }
}
```

**子组件 Promise 处理**：
```typescript
async function renderChildren(children: JSXChildren, context?: ComponentContext): Promise<SendContent> {
    // ... 
    // 如果子元素是 Promise，自动 await
    if (children && typeof children === 'object' && 'then' in children) {
        try {
            return await children;
        } catch (error) {
            return `❌ 组件渲染失败: ${errorMessage}`;
        }
    }
}
```

## 使用方式

### 定义异步组件

```tsx
import { defineComponent, addComponent } from 'zhin.js';

const AsyncComponent = defineComponent(async function AsyncComponent({ userId }: { userId: string }) {
  // 执行异步操作
  const user = await fetchUserFromDatabase(userId);
  const profile = await fetchUserProfile(userId);
  
  return `👤 ${user.name}\n📧 ${profile.email}`;
}, 'AsyncComponent');

addComponent(AsyncComponent);
```

### 在 JSX 中使用（现在完全类型安全）

```tsx
addCommand(
  new MessageCommand('用户 <userId:text>')
    .action(async (message, result) => {
      // ✅ 直接使用 JSX 语法，无需 @ts-expect-error
      return <AsyncComponent userId={result.params.userId} />
    })
);
```

### 嵌套异步组件

```tsx
const UserProfile = defineComponent(async function UserProfile({ userId }: { userId: string }) {
  const user = await fetchUser(userId);
  
  // 嵌套使用其他异步组件
  return (
    <div>
      <h1>{user.name}</h1>
      <AsyncComponent userId={userId} />
    </div>
  );
}, 'UserProfile');
```

## 错误处理

异步组件中的错误会自动被捕获并返回友好的错误信息：

```tsx
const FailingComponent = defineComponent(async function FailingComponent() {
  throw new Error('数据加载失败');
}, 'FailingComponent');

// 使用时会自动返回: "❌ 组件渲染失败: 数据加载失败"
```

## 性能考虑

- **自动 await**：框架自动检测 Promise 并等待，无额外开销
- **并行渲染**：多个异步组件可以并行加载（使用 `Promise.all`）
- **错误隔离**：单个组件错误不会影响整体渲染

## 迁移指南

如果你之前使用了 `@ts-expect-error` 或直接函数调用：

```tsx
// ❌ 旧方式（已废弃）
return await ShareMusic({ platform: 'qq', musicId: '123' });

// ✅ 新方式（推荐）
return <ShareMusic platform="qq" musicId="123" />
```

## TypeScript 类型

```typescript
// JSX.Element 现在支持 Promise
declare global {
    namespace JSX {
        type Element = MessageComponent<any> | Promise<MessageComponent<any>> | Promise<SendContent>
    }
}

// MessageComponent 支持异步函数
export type MessageComponent<T extends object> = {
    type: Component<T & {children?: SendContent}> | ((props: T & {children?: SendContent}) => Promise<SendContent>)
    data: T
}
```

## 测试

确保你的异步组件正确工作：

```typescript
import { describe, it, expect } from 'vitest';

describe('Async Components', () => {
  it('should render async component', async () => {
    const result = await renderJSX(<AsyncComponent userId="123" />);
    expect(result).toBe('👤 User Name\n📧 user@example.com');
  });
  
  it('should handle errors gracefully', async () => {
    const result = await renderJSX(<FailingComponent />);
    expect(result).toMatch(/❌ 组件渲染失败/);
  });
});
```

---

**版本**: 1.0.15+  
**文档更新**: 2025-11-19
