# 通用样式系统

基于 PrimeVue 的积木式页面构建系统，让开发者无需编写任何自定义样式，就能构建统一、美观、响应式的页面。

## 设计理念

- **零自定义样式**: 页面组件的 `<style>` 部分只需要一行注释
- **积木式构建**: 使用预定义的 class 和 PrimeVue 组件组合
- **主题一致性**: 自动适配 PrimeVue 主题，支持明暗切换
- **响应式优先**: 所有组件都包含完整的响应式断点

## 核心组件

### 页面布局

```vue
<template>
  <div class="page-layout">
    <!-- 页面头部 -->
    <Card class="page-header-card">
      <template #content>
        <div class="flex-row justify-between">
          <div class="flex-row">
            <div class="icon-container icon-primary">
              <i class="pi pi-desktop"></i>
            </div>
            <div class="flex-column">
              <h1>页面标题</h1>
              <p>页面描述</p>
            </div>
          </div>
          <Button icon="pi pi-refresh" label="操作" />
        </div>
      </template>
    </Card>
    
    <!-- 统计卡片 -->
    <div class="stats-container">
      <Card class="stats-card">
        <template #content>
          <div class="flex-row gap-large">
            <div class="icon-container icon-blue">
              <i class="pi pi-chart-bar"></i>
            </div>
            <div class="flex-column flex-1">
              <div class="stat-value">123</div>
              <div class="stat-label">统计标签</div>
              <div class="stat-sub">辅助信息</div>
            </div>
          </div>
        </template>
      </Card>
    </div>
    
    <!-- 主内容区域 -->
    <div class="layout-container">
      <div class="layout-main">
        <Card class="content-card">
          <template #title>
            <i class="pi pi-list"></i>
            <span>内容标题</span>
          </template>
          <template #content>
            <!-- 内容 -->
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>
```

### 布局类

| Class | 说明 | 用途 |
|-------|------|------|
| `page-layout` | 页面根容器 | 设置基础布局结构 |
| `page-header-card` | 页面头部卡片 | 渐变背景的页面标题区域 |
| `stats-container` | 统计卡片容器 | Flex 布局的统计卡片组 |
| `stats-card` | 统计卡片 | 带悬停效果的统计卡片 |
| `content-card` | 内容卡片 | 标准内容卡片样式 |
| `layout-container` | 主布局容器 | 两栏布局容器 |
| `layout-main` | 主内容区域 | 左侧主要内容 |
| `layout-sidebar` | 侧边栏区域 | 右侧辅助内容 |

### Flex 工具类

| Class | 说明 |
|-------|------|
| `flex-row` | 水平 Flex 布局 |
| `flex-column` | 垂直 Flex 布局 |
| `flex-1` | flex: 1 |
| `flex-none` | flex: none |
| `justify-between` | justify-content: space-between |
| `gap-large` | 较大间距 |

### 图标容器

```vue
<!-- 大图标容器 -->
<div class="icon-container icon-primary">
  <i class="pi pi-desktop"></i>
</div>

<!-- 小图标容器 -->
<div class="icon-container icon-small icon-blue">
  <i class="pi pi-user"></i>
</div>
```

#### 图标主题色

| Class | 颜色 | 用途 |
|-------|------|------|
| `icon-primary` | 主题色 | 通用图标 |
| `icon-blue` | 蓝色 | 信息类图标 |
| `icon-green` | 绿色 | 成功/活跃类图标 |
| `icon-purple` | 紫色 | 特殊功能图标 |
| `icon-orange` | 橙色 | 警告/重要图标 |

### 详情项目

```vue
<div class="detail-grid">
  <div class="detail-item">
    <div class="icon-container icon-small icon-blue">
      <i class="pi pi-user"></i>
    </div>
    <div class="flex-column flex-1">
      <div class="detail-label">标签</div>
      <div class="detail-value">值</div>
    </div>
  </div>
</div>
```

### 上下文项目

```vue
<div class="grid-auto-fit">
  <div class="context-item">
    <div class="icon-container icon-small icon-primary">
      <i class="pi pi-server"></i>
    </div>
    <div class="flex-column flex-1">
      <div class="detail-label">服务名称</div>
      <div class="detail-value">描述</div>
    </div>
    <Tag value="状态" severity="success" size="small" />
  </div>
</div>
```

### 空状态

```vue
<div class="empty-state">
  <div class="icon-container">
    <i class="pi pi-inbox"></i>
  </div>
  <h3>空状态标题</h3>
  <p>空状态描述</p>
</div>
```

### 文本样式类

| Class | 说明 |
|-------|------|
| `stat-value` | 统计数值 |
| `stat-label` | 统计标签 |
| `stat-sub` | 统计辅助信息 |
| `detail-label` | 详情标签 |
| `detail-value` | 详情值 |

## 响应式断点

- **桌面**: `>1024px` - 完整的两栏布局
- **平板**: `768px-1024px` - 垂直堆叠布局
- **手机**: `<768px` - 紧凑单列布局
- **小屏**: `<480px` - 极简垂直布局

## 主题支持

系统完全基于 PrimeVue CSS 变量，支持：

- 明暗主题自动切换
- 自定义主题色彩
- 品牌色彩一致性
- 无缝主题过渡

## 使用示例

参见 `components/StyleGuide.vue` 中的完整示例，展示了如何使用这个系统快速构建功能完整、外观统一的页面。

## 最佳实践

1. **始终使用预定义类**: 不要编写自定义样式
2. **保持组件简洁**: 让样式系统处理所有视觉呈现
3. **利用 PrimeVue 组件**: Card、Button、Tag 等组件已经集成到系统中
4. **响应式思维**: 系统已处理所有响应式场景
5. **主题一致性**: 使用标准的图标主题色和 PrimeVue 严重度级别
