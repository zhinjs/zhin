# 组件开发指南

Zhin.js 采用函数式组件架构，提供类似 React 的开发体验，支持异步操作和严格的上下文控制。

## 🎯 核心概念

### 函数式组件

所有组件都是纯函数，接收 `props` 和 `context` 参数：

```typescript
import { defineComponent, ComponentContext } from 'zhin.js';

const MyComponent = defineComponent(async function MyComponent(
  props: { title: string; count?: number },
  context: ComponentContext
) {
  return `标题: ${props.title}, 计数: ${props.count || 0}`;
}, 'my-component');
```

### 组件上下文

`ComponentContext` 提供组件运行时的所有必要信息：

```typescript
interface ComponentContext {
  // 基础渲染能力
  render: (template: string, context?: Partial<ComponentContext>) => Promise<SendContent>;
  
  // 数据访问（只读）
  props: Readonly<Dict>;
  
  // 父组件上下文（只读）
  parent?: Readonly<ComponentContext>;
  
  // 根模板（只读）
  root: string;
  
  // 消息对象（只读）
  message?: Readonly<Message>;
  
  // 子组件内容（React 概念）
  children?: string;
  
  // 工具函数
  utils: {
    getValue: (template: string) => any;
    compile: (template: string) => string;
    escape: (content: string) => string;
  };
}
```

## 🚀 基础用法

### 1. 创建简单组件

```typescript
import { defineComponent, segment } from 'zhin.js';

// 文本组件
const TextComponent = defineComponent(async function TextComponent(
  props: { content: string; bold?: boolean },
  context: ComponentContext
) {
  const text = props.bold ? `**${props.content}**` : props.content;
  return segment('text', { text });
}, 'text');

// 图片组件
const ImageComponent = defineComponent(async function ImageComponent(
  props: { url: string; alt?: string },
  context: ComponentContext
) {
  return segment('image', { 
    url: props.url,
    alt: props.alt || '图片'
  });
}, 'image');
```

### 2. 使用 children 属性

```typescript
// 卡片组件 - 支持 children
const CardComponent = defineComponent(async function CardComponent(
  props: { 
    title: string; 
    children?: string;
    color?: string;
  },
  context: ComponentContext
) {
  const color = props.color || 'blue';
  const icon = color === 'blue' ? '🔵' : '🟢';
  
  return [
    segment('text', { text: `${icon} **${props.title}**\n` }),
    segment('text', { text: props.children || 'No content' }),
    segment('text', { text: '\n' + '─'.repeat(20) })
  ];
}, 'card');
```

### 3. 条件渲染

```typescript
// 条件渲染组件
const ConditionalComponent = defineComponent(async function ConditionalComponent(
  props: {
    condition: boolean;
    children?: string;
    fallback?: string;
  },
  context: ComponentContext
) {
  if (props.condition) {
    return props.children || '';
  }
  return props.fallback || '';
}, 'conditional');
```

## 🔧 高级特性

### 1. 使用内置组件

Zhin.js 提供两个内置组件：

#### Fragment 组件
```typescript
// 直接渲染 children，不添加包装
<Fragment>Hello World</Fragment>
```

#### Fetch 组件
```typescript
// 异步获取远程内容
<Fetch url="https://api.example.com/data" />
```

### 2. 组件嵌套和组合

```typescript
// 用户信息组件
const UserInfoComponent = defineComponent(async function UserInfoComponent(
  props: { userId: string },
  context: ComponentContext
) {
  // 使用其他组件
  return await context.render(`
    <Card title="用户信息" color="blue">
      <Text content="用户ID: ${props.userId}" bold={true} />
      <Fetch url="https://api.example.com/user/${props.userId}" />
    </Card>
  `, context);
}, 'user-info');
```

### 3. 异步数据处理

```typescript
// 数据获取组件
const DataComponent = defineComponent(async function DataComponent(
  props: { apiUrl: string; loadingText?: string },
  context: ComponentContext
) {
  try {
    const response = await fetch(props.apiUrl);
    const data = await response.json();
    
    return [
      segment('text', { text: `数据: ${JSON.stringify(data)}` })
    ];
  } catch (error) {
    return [
      segment('text', { text: `错误: ${error.message}` })
    ];
  }
}, 'data');
```

### 4. 列表渲染

```typescript
// 列表组件
const ListComponent = defineComponent(async function ListComponent(
  props: { 
    items: string[];
    title?: string;
    numbered?: boolean;
  },
  context: ComponentContext
) {
  const header = props.title ? `\n=== ${props.title} ===\n` : '';
  const listItems = props.items.map((item, index) => {
    const prefix = props.numbered ? `${index + 1}. ` : '• ';
    return `${prefix}${item}`;
  }).join('\n');
  
  return `${header}${listItems}`;
}, 'list');
```

## 🎨 最佳实践

### 1. 组件命名

```typescript
// ✅ 好的命名 - 使用 PascalCase
const UserCardComponent = defineComponent(async function UserCardComponent() {
  // ...
}, 'user-card');

// ❌ 避免的命名
const userCard = defineComponent(async function userCard() {
  // ...
}, 'userCard');
```

### 2. Props 类型定义

```typescript
// ✅ 明确定义 Props 类型
interface CardProps {
  title: string;
  content?: string;
  children?: string;
  color?: 'blue' | 'green' | 'red' | 'yellow';
  size?: 'small' | 'medium' | 'large';
}

const CardComponent = defineComponent(async function CardComponent(
  props: CardProps,
  context: ComponentContext
) {
  // ...
}, 'card');
```

### 3. 错误处理

```typescript
const SafeComponent = defineComponent(async function SafeComponent(
  props: { data: any },
  context: ComponentContext
) {
  try {
    // 可能出错的操作
    const result = await processData(props.data);
    return segment('text', { text: `结果: ${result}` });
  } catch (error) {
    return segment('text', { text: `处理失败: ${error.message}` });
  }
}, 'safe');
```

### 4. 性能优化

```typescript
// 使用 memo 模式避免不必要的重新渲染
const MemoComponent = defineComponent(async function MemoComponent(
  props: { data: any },
  context: ComponentContext
) {
  // 只在 props.data 变化时重新计算
  const processedData = useMemo(() => {
    return expensiveCalculation(props.data);
  }, [props.data]);
  
  return segment('text', { text: processedData });
}, 'memo');
```

## 🔄 组件生命周期

函数式组件没有传统的生命周期，但可以通过以下方式处理：

### 1. 初始化逻辑

```typescript
const InitializedComponent = defineComponent(async function InitializedComponent(
  props: { config: any },
  context: ComponentContext
) {
  // 组件初始化逻辑
  const config = await loadConfig(props.config);
  
  return segment('text', { text: `配置已加载: ${config.name}` });
}, 'initialized');
```

### 2. 清理逻辑

```typescript
const CleanupComponent = defineComponent(async function CleanupComponent(
  props: { resource: any },
  context: ComponentContext
) {
  try {
    // 使用资源
    const result = await useResource(props.resource);
    return segment('text', { text: result });
  } finally {
    // 清理资源
    await cleanupResource(props.resource);
  }
}, 'cleanup');
```

## 📝 模板语法

### 1. 基本语法

```typescript
// 在组件中使用模板语法
const TemplateComponent = defineComponent(async function TemplateComponent(
  props: { user: any },
  context: ComponentContext
) {
  return await context.render(`
    <Card title="用户信息" color="blue">
      <Text content="姓名: ${props.user.name}" bold={true} />
      <Text content="邮箱: ${props.user.email}" />
      <List items={props.user.hobbies} title="爱好" />
    </Card>
  `, context);
}, 'template');
```

### 2. 条件渲染

```typescript
const ConditionalTemplate = defineComponent(async function ConditionalTemplate(
  props: { user: any; showDetails: boolean },
  context: ComponentContext
) {
  return await context.render(`
    <Card title="用户信息">
      <Text content="姓名: ${props.user.name}" />
      <Conditional condition={props.showDetails}>
        <Text content="邮箱: ${props.user.email}" />
        <Text content="电话: ${props.user.phone}" />
      </Conditional>
    </Card>
  `, context);
}, 'conditional-template');
```

## 🧪 测试组件

### 1. 单元测试

```typescript
import { createComponentContext } from 'zhin.js';

describe('CardComponent', () => {
  it('should render with title and content', async () => {
    const context = createComponentContext();
    const result = await CardComponent({
      title: 'Test Title',
      content: 'Test Content'
    }, context);
    
    expect(result).toContain('Test Title');
    expect(result).toContain('Test Content');
  });
});
```

### 2. 集成测试

```typescript
describe('Component Integration', () => {
  it('should render nested components', async () => {
    const context = createComponentContext();
    const result = await context.render(`
      <Card title="Test">
        <Text content="Hello World" />
      </Card>
    `, context);
    
    expect(result).toContain('Test');
    expect(result).toContain('Hello World');
  });
});
```

## 🔗 相关链接

- [API 参考](../api/index.md)
- [类型定义](../api/types.md)
- [高级示例](../examples/advanced-usage.md)
- [最佳实践](../guide/best-practices.md)
