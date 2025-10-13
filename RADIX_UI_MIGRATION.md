# Radix UI 完整迁移指南

## 📋 概述

Zhin.js 已完全迁移到 **Radix UI** 和 **@radix-ui/themes**，所有自定义 UI 组件均已移除。

## ✅ 已完成的迁移

### 1. 核心模块

#### `@zhin.js/client`
- ✅ 添加 `radix-ui` (v1.4.3) 依赖
- ✅ 添加 `@radix-ui/themes` (v3.2.1) 依赖
- ✅ 添加 `lucide-react` (v0.469.0) 图标库
- ✅ 导出所有 Radix UI 组件：`export * from 'radix-ui'`
- ✅ 导出 Themes：`export * as Themes from '@radix-ui/themes'`
- ✅ 导出 Icons：`export * as Icons from 'lucide-react'`
- ✅ 保留 `cn` 工具函数

#### `@zhin.js/ui` 包
- ✅ **已完全移除**
- ✅ 删除所有自定义组件（Card, Button, Badge, Input 等）
- ✅ 删除所有相关文档和配置文件

### 2. 应用层迁移

#### `plugins/client/app`

**main.tsx**
- ✅ 导入 `@radix-ui/themes/styles.css`
- ✅ 用 `<Themes.Theme>` 包裹应用
- ✅ 配置全局主题：
  ```tsx
  <Themes.Theme 
    accentColor="blue" 
    grayColor="slate" 
    radius="large" 
    scaling="100%"
  >
  ```

**所有页面组件** (已完全重写)
- ✅ `dashboard-home.tsx` - 系统概览
- ✅ `dashboard-bots.tsx` - 机器人管理
- ✅ `dashboard-plugins.tsx` - 插件管理
- ✅ `dashboard-plugin-detail.tsx` - 插件详情
- ✅ `dashboard-logs.tsx` - 系统日志
- ✅ `dashboard.tsx` (layout) - 主布局

**ProcessSandbox** (adapters/process)
- ✅ `ProcessSandbox.tsx` - 沙盒测试页面

### 3. 组件使用对照表

| 功能 | 旧组件 | 新组件 |
|------|--------|--------|
| **布局** |
| 容器 | `<div>` | `<Themes.Box>` |
| 弹性布局 | `<div className="flex">` | `<Themes.Flex>` |
| 网格布局 | `<div className="grid">` | `<Themes.Grid>` |
| **卡片** |
| 卡片 | `<Card>` | `<Themes.Card>` |
| 卡片标题 | `<CardTitle>` | `<Themes.Heading>` |
| 卡片内容 | `<CardContent>` | `<Themes.Box p="4">` |
| **文本** |
| 标题 | `<h1>` | `<Themes.Heading size="8">` |
| 文本 | `<p>` | `<Themes.Text>` |
| 代码 | `<code>` | `<Themes.Code>` |
| **按钮** |
| 按钮 | `<Button>` | `<Themes.Button>` |
| **表单** |
| 输入框 | `<Input>` | `<Themes.TextField.Root>` |
| 复选框 | `<Checkbox>` | `<Themes.Checkbox>` |
| 选择器 | `<Select>` | `<Themes.Select.Root>` |
| **反馈** |
| 徽章 | `<Badge>` | `<Themes.Badge>` |
| 加载器 | `<Spinner>` | `<Themes.Spinner>` |
| 提示框 | `<Alert>` | `<Themes.Callout.Root>` |
| **其他** |
| 分隔线 | `<Separator>` | `<Themes.Separator>` |
| 标签页 | `<Tabs>` | `<Themes.Tabs.Root>` |
| 头像 | `<Avatar>` (from radix-ui) | 同左 |
| 下拉菜单 | `<DropdownMenu>` (from radix-ui) | 同左 |

## 🎨 新的组件使用方式

### 基础布局

```tsx
// 容器
<Themes.Box p="4" mb="2">内容</Themes.Box>

// 弹性布局
<Themes.Flex direction="row" align="center" justify="between" gap="2">
  <div>项目1</div>
  <div>项目2</div>
</Themes.Flex>

// 网格布局
<Themes.Grid columns={{ initial: '1', md: '2', lg: '3' }} gap="4">
  <div>列1</div>
  <div>列2</div>
</Themes.Grid>
```

### 卡片组件

```tsx
<Themes.Card>
  <Themes.Flex direction="column" gap="3" p="4">
    <Themes.Heading size="5">标题</Themes.Heading>
    <Themes.Text color="gray">内容</Themes.Text>
  </Themes.Flex>
</Themes.Card>
```

### 按钮和表单

```tsx
// 按钮
<Themes.Button variant="solid" size="2">
  <Icons.Plus size={16} />
  添加
</Themes.Button>

// 输入框
<Themes.TextField.Root
  value={value}
  onChange={(e) => setValue(e.target.value)}
  placeholder="请输入..."
/>

// 复选框
<Themes.Checkbox 
  checked={checked} 
  onCheckedChange={setChecked}
/>

// 选择器
<Themes.Select.Root value={value} onValueChange={setValue}>
  <Themes.Select.Trigger />
  <Themes.Select.Content>
    <Themes.Select.Item value="option1">选项1</Themes.Select.Item>
  </Themes.Select.Content>
</Themes.Select.Root>
```

### 反馈组件

```tsx
// 徽章
<Themes.Badge color="green" variant="soft">在线</Themes.Badge>

// 加载器
<Themes.Spinner size="3" />

// 提示框
<Themes.Callout.Root color="red">
  <Themes.Callout.Icon>
    <Icons.AlertCircle />
  </Themes.Callout.Icon>
  <Themes.Callout.Text>错误信息</Themes.Callout.Text>
</Themes.Callout.Root>
```

### 图标使用

```tsx
import { Icons } from '@zhin.js/client'

<Icons.Home size={20} color="var(--blue-9)" />
<Icons.Settings size={16} />
<Icons.User className="w-5 h-5" />
```

## 📦 依赖管理

### 已安装的包

```json
{
  "radix-ui": "^1.4.3",
  "@radix-ui/themes": "^3.2.1",
  "lucide-react": "^0.469.0",
  "clsx": "^2.1.1",
  "tailwind-merge": "^3.3.1"
}
```

### 已移除的包

- `@zhin.js/ui` (整个包)
- 所有单独的 `@radix-ui/react-*` 包（现在通过 `radix-ui` 元包提供）
- `class-variance-authority`
- `@heroui/*`
- `@heroicons/*`

## 🎯 主题系统

### 全局主题配置

```tsx
<Themes.Theme 
  accentColor="blue"      // 主色调: blue, green, red, purple 等
  grayColor="slate"       // 灰色调: gray, slate, sand 等
  radius="large"          // 圆角: none, small, medium, large, full
  scaling="100%"          // 缩放: 90%, 95%, 100%, 105%, 110%
>
  {/* 应用内容 */}
</Themes.Theme>
```

### CSS 变量使用

```tsx
// 颜色变量 (1-12 级别，9 为主色，1 最浅)
style={{ 
  color: 'var(--blue-9)',           // 蓝色文本
  backgroundColor: 'var(--gray-2)', // 浅灰背景
  borderColor: 'var(--red-6)'       // 红色边框
}}
```

### 响应式设计

```tsx
<Themes.Grid 
  columns={{ 
    initial: '1',  // 手机
    sm: '2',       // 平板
    md: '2',       // 小桌面
    lg: '3'        // 大桌面
  }} 
  gap="4"
>
  ...
</Themes.Grid>
```

## 📂 文件结构变化

### 删除的文件/目录

```
packages/ui/                          # 整个 UI 包已删除
plugins/client/app/src/components/    # 所有自定义组件已删除
  ├── Card.tsx
  ├── Button.tsx
  ├── Badge.tsx
  ├── Input.tsx
  └── index.ts
plugins/client/THEME_SYSTEM.md        # 旧主题文档
plugins/client/RADIX_UI_GUIDE.md      # 临时文档
```

### 保留的文件

```
plugins/client/app/src/
  ├── components/
  │   └── ThemeToggle.tsx            # 主题切换组件
  ├── theme/
  │   └── index.ts                    # 主题配置（明暗主题）
  └── hooks/
      └── useTheme.ts                 # 主题 Hook
```

## 🚀 优势

1. **更轻量**：移除了 ~1MB 的自定义 UI 代码
2. **更一致**：所有组件遵循统一的 Radix UI 设计语言
3. **更强大**：直接使用 Radix UI 的完整功能集
4. **更易维护**：只需跟随 Radix UI 官方更新
5. **更好的可访问性**：Radix UI 内置完整的 ARIA 和键盘导航支持
6. **更好的主题系统**：@radix-ui/themes 提供完整的设计令牌系统

## 📖 参考资源

- [Radix UI Themes 官方文档](https://www.radix-ui.com/themes/docs)
- [Radix UI Primitives 官方文档](https://www.radix-ui.com/primitives/docs)
- [Lucide Icons](https://lucide.dev/icons/)

## 🔄 迁移检查清单

- [x] 移除 `@zhin.js/ui` 包
- [x] 安装 `radix-ui` 和 `@radix-ui/themes`
- [x] 更新 `@zhin.js/client` 导出
- [x] 添加 Themes Provider 到 `main.tsx`
- [x] 重写所有页面组件
- [x] 更新 ProcessSandbox
- [x] 移除所有自定义 UI 组件
- [x] 测试所有页面功能
- [x] 更新文档

## ✨ 总结

Zhin.js 现在完全基于 Radix UI 构建，提供了一个现代化、可维护、可访问的用户界面系统。所有组件都通过 `@zhin.js/client` 统一导出，使用方式简洁明了。

