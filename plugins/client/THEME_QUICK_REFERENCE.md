# Radix UI Themes 快速参考

> 快速查找 Radix UI Themes 的常用配置和组件用法

## 🎨 主题配置速查

### 完整配置示例

```tsx
import { Theme } from '@radix-ui/themes'

<Theme
  accentColor="blue"        // 主色调
  grayColor="slate"         // 灰色调
  radius="large"            // 圆角大小
  scaling="100%"            // 缩放比例
  appearance="light"        // 明暗模式
  panelBackground="solid"   // 面板背景
>
  <App />
</Theme>
```

### 主色调 (accentColor)

| 颜色 | 描述 | 适用场景 |
|------|------|----------|
| `blue` | 蓝色 | 通用、专业 |
| `purple` | 紫色 | 创意、科技 |
| `green` | 绿色 | 环保、健康 |
| `red` | 红色 | 紧急、警告 |
| `orange` | 橙色 | 活力、友好 |
| `cyan` | 青色 | 清新、科技 |
| `pink` | 粉色 | 时尚、年轻 |
| `brown` | 棕色 | 自然、复古 |

### 灰色调 (grayColor)

| 颜色 | 描述 | 色温 |
|------|------|------|
| `slate` | 石板灰 | 冷色调 |
| `gray` | 中性灰 | 中性 |
| `sand` | 沙色灰 | 暖色调 |
| `mauve` | 淡紫灰 | 偏暖 |
| `sage` | 鼠尾草灰 | 偏冷 |
| `olive` | 橄榄灰 | 偏暖 |
| `auto` | 自动匹配 | - |

### 圆角大小 (radius)

| 值 | 效果 | 视觉感受 |
|----|------|----------|
| `none` | 无圆角 | 锐利、严肃 |
| `small` | 小圆角 (2px) | 现代、简约 |
| `medium` | 中圆角 (4px) | 平衡、通用 |
| `large` | 大圆角 (8px) | 柔和、友好 |
| `full` | 完全圆形 | 可爱、有趣 |

### 缩放比例 (scaling)

| 值 | 适用场景 |
|----|----------|
| `90%` | 信息密集型应用 |
| `95%` | 紧凑布局 |
| `100%` | 标准（推荐） |
| `105%` | 大屏幕 |
| `110%` | 无障碍（老年人） |

## 🧩 组件速查

### 布局组件

```tsx
// Flex 弹性布局
<Flex direction="row|column" gap="1-9" p="1-9" align="start|center|end" justify="start|center|end|between">

// Grid 网格布局
<Grid columns="1-12" gap="1-9" rows="1-12">

// Box 通用容器
<Box p="1-9" m="1-9" width="auto|100%" height="auto|100%">

// Container 响应式容器
<Container size="1|2|3|4">
```

### 排版组件

```tsx
// 标题 (size: 1-9)
<Heading size="8" weight="light|regular|medium|bold">

// 文本 (size: 1-9)
<Text size="3" color="gray|red|blue..." weight="light|regular|medium|bold">

// 代码
<Code variant="solid|soft|outline|ghost">

// 引用
<Quote>

// 强调
<Em>

// 粗体
<Strong>

// 键盘
<Kbd>
```

### 按钮组件

```tsx
// 标准按钮
<Button 
  variant="solid|soft|outline|ghost"  // 变体
  color="blue|red|green..."           // 颜色
  size="1|2|3|4"                      // 大小
  radius="none|small|medium|large"    // 圆角
  disabled={boolean}                  // 禁用
>

// 图标按钮
<IconButton>
  <Icon />
</IconButton>
```

### 表单组件

```tsx
// 文本输入
<TextField.Root 
  size="1|2|3"
  variant="classic|surface|soft"
  color="blue|red..."
  placeholder="..."
>
  <TextField.Slot>前缀</TextField.Slot>
  <TextField.Slot>后缀</TextField.Slot>
</TextField.Root>

// 多行文本
<TextArea 
  size="1|2|3"
  variant="classic|surface|soft"
  placeholder="..."
  resize="none|vertical|horizontal|both"
/>

// 选择器
<Select.Root>
  <Select.Trigger />
  <Select.Content>
    <Select.Item value="1">选项 1</Select.Item>
    <Select.Item value="2">选项 2</Select.Item>
  </Select.Content>
</Select.Root>

// 复选框
<Checkbox size="1|2|3" color="blue|red..." />

// 单选框
<Radio size="1|2|3" color="blue|red..." />

// 开关
<Switch size="1|2|3" color="blue|red..." />

// 滑块
<Slider size="1|2|3" color="blue|red..." min={0} max={100} step={1} />
```

### 反馈组件

```tsx
// 卡片
<Card size="1|2|3|4|5" variant="classic|surface">

// 提示框
<Callout.Root color="blue|red|green...">
  <Callout.Icon><Icon /></Callout.Icon>
  <Callout.Text>内容</Callout.Text>
</Callout.Root>

// 徽章
<Badge size="1|2|3" variant="solid|soft|outline" color="blue|red...">

// 加载器
<Spinner size="1|2|3" loading={boolean} />

// 进度条
<Progress size="1|2|3" value={50} max={100} />

// 骨架屏
<Skeleton width="100%" height="20px" />
```

### 覆盖层组件

```tsx
// 对话框
<Dialog.Root>
  <Dialog.Trigger><Button>打开</Button></Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Title>标题</Dialog.Title>
    <Dialog.Description>描述</Dialog.Description>
    <Flex gap="3" mt="4" justify="end">
      <Dialog.Close><Button>取消</Button></Dialog.Close>
      <Button>确认</Button>
    </Flex>
  </Dialog.Content>
</Dialog.Root>

// 警告对话框
<AlertDialog.Root>
  <AlertDialog.Trigger><Button>删除</Button></AlertDialog.Trigger>
  <AlertDialog.Content>
    <AlertDialog.Title>确认删除？</AlertDialog.Title>
    <AlertDialog.Description>此操作无法撤销</AlertDialog.Description>
    <Flex gap="3" mt="4" justify="end">
      <AlertDialog.Cancel><Button>取消</Button></AlertDialog.Cancel>
      <AlertDialog.Action><Button color="red">删除</Button></AlertDialog.Action>
    </Flex>
  </AlertDialog.Content>
</AlertDialog.Root>

// 下拉菜单
<DropdownMenu.Root>
  <DropdownMenu.Trigger><Button>菜单</Button></DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <DropdownMenu.Item>项目 1</DropdownMenu.Item>
    <DropdownMenu.Item>项目 2</DropdownMenu.Item>
    <DropdownMenu.Separator />
    <DropdownMenu.Item color="red">删除</DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>

// 弹出框
<Popover.Root>
  <Popover.Trigger><Button>信息</Button></Popover.Trigger>
  <Popover.Content>
    <Heading size="3">标题</Heading>
    <Text>内容</Text>
  </Popover.Content>
</Popover.Root>

// 工具提示
<Tooltip content="提示内容">
  <Button>悬停</Button>
</Tooltip>

// 悬浮卡片
<HoverCard.Root>
  <HoverCard.Trigger><Link>用户</Link></HoverCard.Trigger>
  <HoverCard.Content>
    <Flex gap="3">
      <Avatar src="..." />
      <Box>
        <Heading size="3">用户名</Heading>
        <Text>描述</Text>
      </Box>
    </Flex>
  </HoverCard.Content>
</HoverCard.Root>

// 上下文菜单
<ContextMenu.Root>
  <ContextMenu.Trigger><Box>右键</Box></ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item>复制</ContextMenu.Item>
    <ContextMenu.Item>粘贴</ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
```

### 导航组件

```tsx
// 标签页
<Tabs.Root defaultValue="tab1">
  <Tabs.List>
    <Tabs.Trigger value="tab1">标签 1</Tabs.Trigger>
    <Tabs.Trigger value="tab2">标签 2</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="tab1">内容 1</Tabs.Content>
  <Tabs.Content value="tab2">内容 2</Tabs.Content>
</Tabs.Root>

// 标签导航
<TabNav.Root>
  <TabNav.Link href="/" active>首页</TabNav.Link>
  <TabNav.Link href="/about">关于</TabNav.Link>
</TabNav.Root>
```

### 数据展示

```tsx
// 表格
<Table.Root variant="surface|ghost">
  <Table.Header>
    <Table.Row>
      <Table.ColumnHeaderCell>名称</Table.ColumnHeaderCell>
      <Table.ColumnHeaderCell>邮箱</Table.ColumnHeaderCell>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    <Table.Row>
      <Table.Cell>张三</Table.Cell>
      <Table.Cell>zhang@example.com</Table.Cell>
    </Table.Row>
  </Table.Body>
</Table.Root>

// 数据列表
<DataList.Root>
  <DataList.Item>
    <DataList.Label>标签</DataList.Label>
    <DataList.Value>值</DataList.Value>
  </DataList.Item>
</DataList.Root>

// 分隔线
<Separator size="4" orientation="horizontal|vertical" />

// 头像
<Avatar 
  size="1|2|3|4|5|6|7|8|9"
  variant="solid|soft"
  color="blue|red..."
  fallback="U"
  src="..."
  radius="none|small|medium|large|full"
/>

// 滚动区域
<ScrollArea 
  type="auto|always|scroll|hover"
  scrollbars="vertical|horizontal|both"
  style={{ height: 200 }}
>
  内容
</ScrollArea>
```

## 🎨 CSS Token 速查

### 颜色（1-12 级）

```css
/* 主色调 */
var(--accent-1)   /* 最浅背景 */
var(--accent-2)   /* 浅背景 */
var(--accent-3)   /* 悬停背景 */
var(--accent-4)   /* 激活背景 */
var(--accent-5)   /* 边框 */
var(--accent-6)   /* 悬停边框 */
var(--accent-7)   /* 实心悬停背景 */
var(--accent-8)   /* 实心背景 */
var(--accent-9)   /* 实心文本/图标 */
var(--accent-10)  /* 悬停实心文本 */
var(--accent-11)  /* 低对比度文本 */
var(--accent-12)  /* 高对比度文本 */

/* 灰色（同上） */
var(--gray-1) 至 var(--gray-12)

/* Alpha 通道（半透明） */
var(--accent-a1) 至 var(--accent-a12)
var(--gray-a1) 至 var(--gray-a12)
```

### 间距（基于 4px）

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

### 字体大小

```css
var(--font-size-1)  /* 12px */
var(--font-size-2)  /* 14px */
var(--font-size-3)  /* 16px */
var(--font-size-4)  /* 18px */
var(--font-size-5)  /* 20px */
var(--font-size-6)  /* 24px */
var(--font-size-7)  /* 28px */
var(--font-size-8)  /* 35px */
var(--font-size-9)  /* 60px */
```

### 圆角

```css
var(--radius-1)     /* 小 */
var(--radius-2)     /* 中 */
var(--radius-3)     /* 大 */
var(--radius-4)     /* 超大 */
var(--radius-5)     /* 最大 */
var(--radius-6)     /* 完全圆形 */
var(--radius-full)  /* 完全圆形（别名） */
```

## 🎯 常用场景

### 表单页面

```tsx
<Container size="2">
  <Card>
    <Flex direction="column" gap="4" p="6">
      <Heading size="6">登录</Heading>
      
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">邮箱</Text>
        <TextField.Root placeholder="your@email.com" />
      </Flex>
      
      <Flex direction="column" gap="2">
        <Text size="2" weight="medium">密码</Text>
        <TextField.Root type="password" placeholder="••••••••" />
      </Flex>
      
      <Flex gap="2">
        <Checkbox id="remember" />
        <Text as="label" htmlFor="remember" size="2">记住我</Text>
      </Flex>
      
      <Button size="3">登录</Button>
    </Flex>
  </Card>
</Container>
```

### 数据面板

```tsx
<Grid columns="3" gap="4">
  <Card>
    <Flex direction="column" gap="2" p="4">
      <Flex justify="between" align="center">
        <Text size="2" color="gray">总用户</Text>
        <Badge color="blue">+12%</Badge>
      </Flex>
      <Heading size="8">1,234</Heading>
      <Text size="1" color="gray">较上月</Text>
    </Flex>
  </Card>
</Grid>
```

### 列表页面

```tsx
<Flex direction="column" gap="3">
  {items.map(item => (
    <Card key={item.id}>
      <Flex justify="between" align="center" p="4">
        <Flex gap="3" align="center">
          <Avatar src={item.avatar} fallback={item.name[0]} />
          <Box>
            <Heading size="3">{item.name}</Heading>
            <Text size="2" color="gray">{item.email}</Text>
          </Box>
        </Flex>
        <Badge color="green">活跃</Badge>
      </Flex>
    </Card>
  ))}
</Flex>
```

### 确认对话框

```tsx
<AlertDialog.Root>
  <AlertDialog.Trigger>
    <Button color="red">删除账号</Button>
  </AlertDialog.Trigger>
  <AlertDialog.Content maxWidth="450px">
    <AlertDialog.Title>确认删除账号？</AlertDialog.Title>
    <AlertDialog.Description>
      此操作将永久删除您的账号和所有数据，无法恢复。
    </AlertDialog.Description>
    <Flex gap="3" mt="4" justify="end">
      <AlertDialog.Cancel>
        <Button variant="soft" color="gray">取消</Button>
      </AlertDialog.Cancel>
      <AlertDialog.Action>
        <Button color="red">删除</Button>
      </AlertDialog.Action>
    </Flex>
  </AlertDialog.Content>
</AlertDialog.Root>
```

## 🚀 性能优化

### 按需导入

```tsx
// ✅ 推荐：按需导入
import { Button, Card, Flex } from '@radix-ui/themes'

// ❌ 避免：全量导入
import * as Radix from '@radix-ui/themes'
```

### 懒加载对话框

```tsx
const Dialog = lazy(() => import('./Dialog'))

<Suspense fallback={<Spinner />}>
  <Dialog />
</Suspense>
```

### 虚拟滚动长列表

```tsx
import { ScrollArea } from '@radix-ui/themes'
import { useVirtualizer } from '@tanstack/react-virtual'

// 使用 react-virtual 处理大量数据
```

## 📚 参考链接

- [官方文档](https://www.radix-ui.com/themes/docs)
- [组件 Playground](https://www.radix-ui.com/themes/playground)
- [颜色系统](https://www.radix-ui.com/colors)
- [图标库](https://lucide.dev/)

