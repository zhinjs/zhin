# 简化版 JSX 支持

Zhin.js 提供简化版的 JSX 语法，专注于核心组件功能，不生成 HTML 标签。

## 🚀 快速开始

### 1. 导入 JSX 运行时

```typescript
import { jsx, jsxs, Fragment, renderJSX } from '@zhin.js/core/jsx';
import { Container, Text, Title, List, Card } from '@zhin.js/core';
```

## 📝 基本用法

### 创建 JSX 元素

```typescript
// 基础 JSX
const element = jsx(Container, {
    title: '欢迎',
    children: [
        jsx(Title, { children: '欢迎使用 JSX!', level: 1 }),
        jsx(Text, { children: '这是一个使用 JSX 语法的组件示例。' }),
        jsx(Card, { 
            header: '提示',
            children: '这是卡片内容'
        })
    ]
});

// 渲染 JSX 元素
const result = await renderJSX(element, context);
```

### 使用 Fragment

```typescript
const fragment = jsx(Fragment, {
    children: [
        jsx(Text, { children: '第一段' }),
        jsx(Text, { children: '第二段' }),
        jsx(Text, { children: '第三段' })
    ]
});
```

## 🎨 内置组件

Zhin.js 提供简化的内置 JSX 组件：

### 容器组件

```typescript
// 容器
jsx(Container, {
    title: '标题',
    children: '内容'
});

// 文本
jsx(Text, {
    bold: true,
    children: '粗体文本'
});

// 标题
jsx(Title, {
    level: 2,
    children: '二级标题'
});
```

### 列表组件

```typescript
// 列表
jsx(List, {
    items: ['项目1', '项目2', '项目3']
});

// 卡片
jsx(Card, {
    header: '卡片标题',
    children: '卡片内容'
});
```

## 🔧 自定义组件

### 创建 JSX 函数组件

```typescript
const UserCard = (props: { user: { name: string; age: number; avatar?: string } }, context?: ComponentContext) => {
    const { user } = props;
    return jsx(Div, {
        className: 'user-card',
        children: [
            user.avatar ? jsx(Img, { src: user.avatar, alt: user.name, className: 'avatar' }) : null,
            jsx(Div, {
                className: 'user-info',
                children: [
                    jsx(H3, { children: user.name }),
                    jsx(P, { children: `年龄: ${user.age}` })
                ]
            })
        ]
    });
};
```

### 使用自定义组件

```typescript
const user = { name: '张三', age: 25, avatar: 'avatar.jpg' };
const userCard = jsx(UserCard, { user });
const html = await renderJSX(userCard, context);
```

## 🎯 高级特性

### 条件渲染

```typescript
const ConditionalComponent = (props: { show: boolean }) => {
    return jsx(Div, {
        children: props.show ? 
            jsx(H1, { children: '显示标题' }) : 
            jsx(P, { children: '隐藏标题' })
    });
};
```

### 列表渲染

```typescript
const ListComponent = (props: { items: string[] }) => {
    return jsx(Div, {
        className: 'list',
        children: props.items.map((item, index) => 
            jsx(Div, {
                key: index,
                className: 'list-item',
                children: jsx(Span, { children: item })
            })
        )
    });
};
```

### 嵌套组件

```typescript
const Layout = (props: { children: JSXChildren }) => {
    return jsx(Div, {
        className: 'layout',
        children: [
            jsx(Div, {
                className: 'header',
                children: jsx(H1, { children: '页面标题' })
            }),
            jsx(Div, {
                className: 'content',
                children: props.children
            })
        ]
    });
};
```

## 🔄 与模板系统集成

JSX 组件可以与现有的模板系统无缝集成：

```typescript
// 在模板中使用 JSX 组件
const template = `
    <div class="page">
        <user-card user={user} />
        <div class="content">
            ${await renderJSX(jsx(P, { children: '动态内容' }), context)}
        </div>
    </div>
`;
```

## 📚 类型支持

### JSX 类型定义

```typescript
import { JSXElement, JSXChildren, JSXFunctionComponent } from '@zhin.js/core/jsx';

// JSX 元素类型
const element: JSXElement = jsx(Div, { children: 'Hello' });

// JSX 子元素类型
const children: JSXChildren = [
    '文本',
    jsx(Span, { children: '组件' }),
    null,
    undefined
];

// JSX 函数组件类型
const MyComponent: JSXFunctionComponent<{ title: string }> = (props, context) => {
    return jsx(H1, { children: props.title });
};
```

## 🎨 样式支持

### 内联样式

```typescript
jsx(Div, {
    style: 'padding: 20px; background: #f0f0f0; border-radius: 8px;',
    children: '带样式的容器'
});
```

### CSS 类名

```typescript
jsx(Button, {
    className: 'btn btn-primary btn-lg',
    children: '大按钮'
});
```

### 动态样式

```typescript
const DynamicButton = (props: { variant: 'primary' | 'secondary' }) => {
    const className = `btn btn-${props.variant}`;
    return jsx(Button, {
        className,
        children: '动态按钮'
    });
};
```

## 🚀 最佳实践

### 1. 组件命名

```typescript
// 使用 PascalCase 命名组件
const UserProfile = (props: UserProfileProps) => { /* ... */ };
const ProductCard = (props: ProductCardProps) => { /* ... */ };
```

### 2. Props 类型定义

```typescript
interface UserCardProps {
    user: {
        name: string;
        age: number;
        avatar?: string;
    };
    className?: string;
    style?: string;
}

const UserCard: JSXFunctionComponent<UserCardProps> = (props, context) => {
    // 组件实现
};
```

### 3. 错误处理

```typescript
const SafeComponent = (props: { data: any }) => {
    try {
        return jsx(Div, {
            children: jsx(P, { children: props.data.message })
        });
    } catch (error) {
        return jsx(Div, {
            className: 'error',
            children: jsx(P, { children: '加载失败' })
        });
    }
};
```

## 🔧 调试技巧

### 1. 查看 JSX 元素结构

```typescript
console.log('JSX 元素:', JSON.stringify(element, null, 2));
```

### 2. 逐步渲染

```typescript
const step1 = jsx(Div, { children: '第一步' });
const step2 = jsx(Div, { children: '第二步' });
const combined = jsx(Div, {
    children: [step1, step2]
});
```

## 📖 总结

JSX 支持让 Zhin.js 的组件开发更加现代化和直观：

- ✅ **直观的语法** - 类似 React 的 JSX 语法
- ✅ **完整的类型支持** - TypeScript 类型检查
- ✅ **丰富的内置组件** - Div、Span、P、H1-H3、Button、Img 等
- ✅ **自定义组件** - 支持函数式组件
- ✅ **模板集成** - 与现有模板系统无缝集成
- ✅ **异步支持** - 支持异步组件渲染

现在你可以使用熟悉的 JSX 语法来开发 Zhin.js 组件了！🎉
