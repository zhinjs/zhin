# Zhin 异步组件使用指南

## 概述

Zhin 组件支持异步渲染（类似 Next.js 的异步组件）：组件的 `render` 可以返回 Promise，在组件内执行异步操作（API 调用、数据库查询等）。本插件的 `components/share-music.ts` 即示例。

> 本文已更新为 Plugin Runtime 写法（`defineComponent` + 约定目录）。旧的 `addComponent` / `MessageCommand` 写法已下线。

## 基础用法

### 1. 定义异步组件

组件放在插件的 `components/` 约定目录，default-export `defineComponent()`；`render` 可以是 `async`：

```ts
// components/user-card.ts
import { defineComponent } from '@zhin.js/component';

interface UserCardProps {
  userId: string;
}

export default defineComponent<UserCardProps>({
  async render(props) {
    const user = await fetchUser(props.userId); // 组件内可异步
    return `👤 ${user.name} (${user.email})`;
  },
});
```

运行时会按 `components/` 目录自动装配，无需手工注册。

### 2. 在命令中使用

命令放在 `commands/` 约定目录，default-export `defineCommand()`；用 `component(name, props)` 引用组件，返回值交给统一出站管道渲染：

```ts
// commands/user-info/[userId].ts
import { defineCommand, component } from 'zhin.js/core/runtime';

export default defineCommand({
  execute: ({ params }) => component('user-card', { userId: String(params.userId) }),
});
```

### 3. 组件互相嵌套

异步组件的 `render` 里可以继续返回 `component(...)` 调用，渲染器会递归解析（深度上限 32）：

```ts
export default defineComponent<UserCardProps>({
  async render(props) {
    const card = await renderUserCard(props.userId);
    return ['个人资料\n', card];
  },
});
```

## 说明

- 组件渲染结果可以是字符串、canonical `Segment`、或它们的数组；媒体与富文本走 Segment 一等公民通道。
- 组件在出站渲染阶段按当前 generation 解析；插件热重载后新代码立即生效，无需额外清理。
