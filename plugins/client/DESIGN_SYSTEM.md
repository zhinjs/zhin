# Zhin.js 设计系统

> 基于 [Radix UI Themes](https://www.radix-ui.com/themes/docs/overview/getting-started) 构建的现代化设计系统

## 🎨 设计理念

本设计系统遵循 Radix UI Themes 的设计哲学：

- **开箱即用** - 预样式化组件，无需复杂配置
- **主题驱动** - 通过 Theme 组件统一管理外观
- **类型安全** - 完整的 TypeScript 支持
- **可访问性** - 符合 WCAG 2.1 标准
- **响应式** - 移动端优先设计

## 📦 核心依赖

```json
{
  "@radix-ui/themes": "^3.2.1",
  "radix-ui": "1.4.3",
  "lucide-react": "^0.469.0"
}
```

## 🚀 快速开始

### 1. 主题配置

在 `main.tsx` 中配置全局主题：

```tsx
import '@radix-ui/themes/styles.css'
import * as Themes from '@radix-ui/themes'

createRoot(document.getElementById('root')).render(
  <Themes.Theme 
    accentColor="blue"    // 主色调
    grayColor="slate"     // 灰色调
    radius="large"        // 圆角大小
    scaling="100%"        // 缩放比例
  >
    <App />
  </Themes.Theme>
)
```

### 2. 主题切换

支持明暗模式自动切换：

```tsx
// 自动模式（跟随系统）
<Themes.Theme appearance="auto">

// 强制亮色
<Themes.Theme appearance="light">

// 强制暗色
<Themes.Theme appearance="dark">
```

### 3. 实时预览

使用 `ThemePanel` 进行实时主题调试：

```tsx
import { Theme, ThemePanel } from '@radix-ui/themes'

<Theme>
  <App />
  <ThemePanel /> {/* 仅开发环境使用 */}
</Theme>
```

## 🎨 主题配置项

### accentColor（主色调）

可用颜色：`tomato` | `red` | `crimson` | `pink` | `plum` | `purple` | `violet` | `indigo` | `blue` | `cyan` | `teal` | `green` | `grass` | `orange` | `brown`

```tsx
<Theme accentColor="blue">  // 默认蓝色
<Theme accentColor="purple"> // 紫色主题
<Theme accentColor="green">  // 绿色主题
```

### grayColor（灰色调）

可用灰色：`auto` | `gray` | `mauve` | `slate` | `sage` | `olive` | `sand`

```tsx
<Theme grayColor="slate">  // 冷色调灰色
<Theme grayColor="sand">   // 暖色调灰色
<Theme grayColor="auto">   // 自动匹配主色调
```

### radius（圆角大小）

可用值：`none` | `small` | `medium` | `large` | `full`

```tsx
<Theme radius="large">   // 大圆角（推荐）
<Theme radius="medium">  // 中等圆角
<Theme radius="full">    // 完全圆形
```

### scaling（整体缩放）

可用值：`90%` | `95%` | `100%` | `105%` | `110%`

```tsx
<Theme scaling="100%">  // 标准大小
<Theme scaling="105%">  // 放大 5%（适合老年人）
<Theme scaling="95%">   // 缩小 5%（信息密集场景）
```

## 🧩 组件使用

### 基础布局

```tsx
import { Flex, Box, Grid, Container } from '@radix-ui/themes'

// Flex 布局
<Flex direction="column" gap="3" p="4">
  <Box>内容 1</Box>
  <Box>内容 2</Box>
</Flex>

// Grid 布局
<Grid columns="3" gap="4" p="4">
  <Box>项目 1</Box>
  <Box>项目 2</Box>
  <Box>项目 3</Box>
</Grid>

// 容器（响应式最大宽度）
<Container size="3">
  <Heading>标题</Heading>
</Container>
```

### 排版组件

```tsx
import { Heading, Text, Code } from '@radix-ui/themes'

<Heading size="8">大标题</Heading>
<Heading size="4">小标题</Heading>
<Text size="3" weight="bold">粗体文本</Text>
<Text color="gray">灰色文本</Text>
<Code>const hello = "world"</Code>
```

### 交互组件

```tsx
import { Button, Badge, Switch, Checkbox } from '@radix-ui/themes'

// 按钮
<Button variant="solid" color="blue">主要按钮</Button>
<Button variant="soft">次要按钮</Button>
<Button variant="outline">边框按钮</Button>
<Button variant="ghost">幽灵按钮</Button>

// 徽章
<Badge color="green">成功</Badge>
<Badge color="red">错误</Badge>
<Badge variant="outline">描边</Badge>

// 开关
<Switch defaultChecked />

// 复选框
<Checkbox />
```

### 表单组件

```tsx
import { TextField, TextArea, Select } from '@radix-ui/themes'

// 文本输入
<TextField.Root placeholder="输入内容..." />

// 多行文本
<TextArea placeholder="输入多行内容..." />

// 选择器
<Select.Root>
  <Select.Trigger />
  <Select.Content>
    <Select.Item value="1">选项 1</Select.Item>
    <Select.Item value="2">选项 2</Select.Item>
  </Select.Content>
</Select.Root>
```

### 反馈组件

```tsx
import { Card, Callout, Spinner } from '@radix-ui/themes'

// 卡片
<Card>
  <Heading>卡片标题</Heading>
  <Text>卡片内容</Text>
</Card>

// 提示框
<Callout.Root color="blue">
  <Callout.Icon>
    <InfoIcon />
  </Callout.Icon>
  <Callout.Text>
    这是一条提示信息
  </Callout.Text>
</Callout.Root>

// 加载器
<Spinner />
```

## 🎨 CSS Token（变量）

Radix UI Themes 使用 CSS 变量进行样式管理，以下是可用的 Token：

### 颜色 Token

```css
/* 主色调（1-12 级） */
var(--accent-1)   /* 最浅 */
var(--accent-9)   /* 标准 */
var(--accent-12)  /* 最深 */

/* 灰色（1-12 级） */
var(--gray-1)     /* 最浅 */
var(--gray-9)     /* 标准 */
var(--gray-12)    /* 最深 */

/* Alpha 通道（半透明） */
var(--accent-a5)  /* 半透明主色 */
var(--gray-a3)    /* 半透明灰色 */
```

### 间距 Token

```css
var(--space-1)  /* 4px */
var(--space-2)  /* 8px */
var(--space-3)  /* 12px */
var(--space-4)  /* 16px */
var(--space-5)  /* 20px */
var(--space-6)  /* 24px */
var(--space-7)  /* 28px */
var(--space-8)  /* 32px */
var(--space-9)  /* 36px */
```

### 圆角 Token

```css
var(--radius-1)  /* 小圆角 */
var(--radius-2)  /* 中圆角 */
var(--radius-3)  /* 大圆角 */
var(--radius-4)  /* 超大圆角 */
var(--radius-full) /* 完全圆形 */
```

## 🌈 自定义增强

在 `style.css` 中，我们对 Radix UI 进行了轻量级增强：

### 1. Glassmorphism（毛玻璃）

```tsx
<Card className="glass">
  <Heading>毛玻璃卡片</Heading>
</Card>
```

CSS 变量：
```css
--glass-bg: rgba(255, 255, 255, 0.75)
--glass-border: rgba(255, 255, 255, 0.2)
--glass-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.1)
```

### 2. 渐变色

```tsx
<Button className="gradient-primary">渐变按钮</Button>
<Heading className="text-gradient">渐变文字</Heading>
```

预定义渐变：
```css
--gradient-primary: 蓝-紫渐变
--gradient-success: 绿-青渐变
--gradient-warning: 琥珀-橙渐变
--gradient-danger: 红-深红渐变
--gradient-info: 蓝-青渐变
```

### 3. 微交互动画

所有组件默认带有平滑过渡：

```css
/* 按钮悬停提升 */
.rt-Button:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-2);
}

/* 卡片悬停效果 */
.rt-Card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-3);
}

/* 徽章缩放 */
.rt-Badge:hover {
  transform: scale(1.05);
}
```

### 4. 自定义工具类

```tsx
// 悬停提升
<Card className="hover-lift">...</Card>

// 悬停发光
<Button className="hover-glow">...</Button>

// 平滑过渡
<Box className="transition-smooth">...</Box>
```

## 🎬 动画系统

### 预定义动画

```css
@keyframes slideDownAndFade {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes contentShow {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

### 使用动画

```tsx
<Box style={{ animation: 'slideDownAndFade 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
  内容
</Box>
```

## 🎯 响应式设计

### 响应式属性

Radix UI Themes 支持响应式属性：

```tsx
// 响应式列数
<Grid columns={{ initial: '1', sm: '2', md: '3', lg: '4' }}>

// 响应式间距
<Flex gap={{ initial: '2', md: '4' }}>

// 响应式显示/隐藏
<Box display={{ initial: 'none', md: 'block' }}>
```

### 断点定义

```css
@media (min-width: 520px)  { /* sm */ }
@media (min-width: 768px)  { /* md */ }
@media (min-width: 1024px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

### 移动端优化

```css
@media (max-width: 768px) {
  /* 禁用悬停效果 */
  .rt-Button:hover {
    transform: none;
  }
}
```

## ♿ 无障碍支持

### 聚焦指示器

所有交互元素都有清晰的聚焦样式：

```css
*:focus-visible {
  outline: 2px solid var(--accent-9);
  outline-offset: 2px;
}
```

### 键盘导航

Radix UI 组件原生支持键盘导航：

- `Tab` / `Shift+Tab` - 切换焦点
- `Space` / `Enter` - 激活按钮
- `Arrow Keys` - 选择器/菜单导航
- `Esc` - 关闭弹窗

### 减少动画

尊重用户的动画偏好：

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 高对比度模式

```css
@media (prefers-contrast: high) {
  .rt-Card,
  .rt-Button {
    border-width: 2px;
  }
}
```

## 🎨 自定义滚动条

```css
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-thumb {
  background: var(--gray-8);
  border-radius: var(--radius-2);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--gray-10);
}
```

## 📋 最佳实践

### ✅ 推荐做法

```tsx
// 1. 使用 Radix 内置的颜色系统
<Badge color="green">成功</Badge>

// 2. 使用响应式属性
<Grid columns={{ initial: '1', md: '2' }}>

// 3. 使用语义化变体
<Button variant="solid">主要</Button>
<Button variant="soft">次要</Button>

// 4. 使用 Radix 的间距系统
<Flex gap="3" p="4">

// 5. 组合使用布局组件
<Container size="3">
  <Flex direction="column" gap="4">
    ...
  </Flex>
</Container>
```

### ❌ 避免做法

```tsx
// 1. 避免硬编码颜色
<Badge style={{ backgroundColor: '#00ff00' }}>

// 2. 避免硬编码间距
<div style={{ gap: '13px', padding: '17px' }}>

// 3. 避免覆盖 Radix 核心样式
.rt-Button {
  background: red !important; /* 不推荐 */
}

// 4. 避免混用多种样式方案
<div className="rt-Box tailwind-class custom-class">
```

## 🎯 实战示例

### 现代化卡片

```tsx
<Card className="glass hover-lift">
  <Flex direction="column" gap="3" p="4">
    <Heading className="text-gradient">标题</Heading>
    <Text color="gray">描述文本</Text>
    <Button className="gradient-primary">操作</Button>
  </Flex>
</Card>
```

### 表单布局

```tsx
<Card>
  <Flex direction="column" gap="3" p="4">
    <Heading size="5">用户信息</Heading>
    
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">用户名</Text>
      <TextField.Root placeholder="请输入用户名" />
    </Flex>
    
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">邮箱</Text>
      <TextField.Root type="email" placeholder="请输入邮箱" />
    </Flex>
    
    <Flex gap="2" mt="2">
      <Button variant="solid">提交</Button>
      <Button variant="soft">取消</Button>
    </Flex>
  </Flex>
</Card>
```

### 数据展示

```tsx
<Grid columns="3" gap="4">
  <Card>
    <Flex direction="column" gap="2" p="4">
      <Flex justify="between" align="center">
        <Text size="2" color="gray">总用户</Text>
        <Badge color="blue">+12%</Badge>
      </Flex>
      <Heading size="8">1,234</Heading>
    </Flex>
  </Card>
  
  <Card>
    <Flex direction="column" gap="2" p="4">
      <Flex justify="between" align="center">
        <Text size="2" color="gray">活跃用户</Text>
        <Badge color="green">+8%</Badge>
      </Flex>
      <Heading size="8">856</Heading>
    </Flex>
  </Card>
  
  <Card>
    <Flex direction="column" gap="2" p="4">
      <Flex justify="between" align="center">
        <Text size="2" color="gray">新增用户</Text>
        <Badge color="orange">+23%</Badge>
      </Flex>
      <Heading size="8">378</Heading>
    </Flex>
  </Card>
</Grid>
```

## 📚 参考资源

- [Radix UI Themes 官方文档](https://www.radix-ui.com/themes/docs/overview/getting-started)
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [Radix Colors](https://www.radix-ui.com/colors)
- [Lucide Icons](https://lucide.dev/)

## 🔄 更新日志

### v2.0.0 (2024-10)

- ✨ 迁移到 Radix UI Themes 3.x
- 🎨 重新设计样式系统，遵循 Radix 设计理念
- 🌈 完整支持明暗主题切换
- ♿ 增强无障碍支持
- 📱 优化响应式设计
- 🚀 性能优化：GPU 加速、will-change

### v1.0.0 (2024-09)

- 🎉 初始版本发布
- 基于 shadcn/ui 的设计系统
