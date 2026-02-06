# Satori

**Satori**: 一个强大的库，用于将 HTML 和 CSS 转换为 SVG。

## 概述

Satori 支持将 HTML 和 CSS 转换为高质量的 SVG 图像。它使用 JSDOM 来解析 HTML，并实现了自己的布局引擎来生成与浏览器渲染结果一致的 SVG。

## 基本用法

```javascript
import satori from '@zhinjs/satori'
import { JSDOM } from 'jsdom'

// 创建 HTML 内容
const html = `
<!DOCTYPE html>
<html>
<body>
  <div style="color: black; padding: 20px; background: #f0f0f0;">
    Hello, World!
  </div>
</body>
</html>
`

// 使用 JSDOM 解析 HTML
const dom = new JSDOM(html)

// 转换为 SVG
const svg = await satori(dom, {
    width: 600,
    height: 400,
    fonts: [
      {
        name: 'Roboto',
      data: robotoArrayBuffer, // 字体数据
        weight: 400,
        style: 'normal',
      },
    ],
})

console.log(svg)
// 输出: '<svg width="600" height="400" viewBox="0 0 600 400">...</svg>'
```

## 功能特性

### 支持的 HTML 元素

Satori 支持大部分常用的 HTML 元素：

- **文本元素**: `div`, `p`, `h1-h6`, `span`, `strong`, `em`, `br`
- **列表元素**: `ul`, `ol`, `li`
- **图片元素**: `img`
- **SVG 元素**: `svg`, `path`, `circle`, `rect` 等

### 支持的 CSS 属性

#### 布局属性
- `display`: `flex`, `none`
- `position`: `relative`, `absolute`
- `width`, `height`, `minWidth`, `minHeight`, `maxWidth`, `maxHeight`

#### Flexbox 属性
- `flexDirection`: `row`, `column`, `row-reverse`, `column-reverse`
- `flexWrap`: `wrap`, `nowrap`, `wrap-reverse`
- `justifyContent`: `flex-start`, `center`, `flex-end`, `space-between`, `space-around`
- `alignItems`: `stretch`, `center`, `flex-start`, `flex-end`, `baseline`
- `gap`: 支持数值

#### 边距和填充
- `margin`, `marginTop`, `marginRight`, `marginBottom`, `marginLeft`
- `padding`, `paddingTop`, `paddingRight`, `paddingBottom`, `paddingLeft`

#### 边框
- `border`, `borderWidth`, `borderStyle`, `borderColor`
- `borderRadius`, `borderTopLeftRadius`, `borderTopRightRadius`, `borderBottomLeftRadius`, `borderBottomRightRadius`

#### 背景
- `backgroundColor`
- `backgroundImage`: 支持 `linear-gradient`, `radial-gradient`, `url()`
- `backgroundPosition`, `backgroundSize`, `backgroundRepeat`

#### 字体和文本
- `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`
- `color`, `textAlign`, `textDecoration`, `textTransform`
- `lineHeight`, `letterSpacing`, `whiteSpace`, `wordBreak`

#### 变换
- `transform`: 支持 `translate`, `rotate`, `scale`, `skew`
- `transformOrigin`

#### 其他
- `opacity`, `boxShadow`, `overflow`, `clipPath`
- `filter`, `maskImage`, `objectFit`

### 字体支持

Satori 支持以下字体格式：
- TTF (TrueType)
- OTF (OpenType)
- WOFF (Web Open Font Format)

**注意**: 目前不支持 WOFF2 格式。

### 视口单位

支持所有视口单位：
- `vw` (视口宽度)
- `vh` (视口高度)
- `vmin` (视口最小值)
- `vmax` (视口最大值)

### 百分比单位

支持百分比值用于：
- 尺寸 (`width`, `height`)
- 边距和填充
- 定位 (`top`, `left`, `right`, `bottom`)

## 安装

```bash
npm install @zhinjs/satori
# 或
yarn add @zhinjs/satori
# 或
pnpm add @zhinjs/satori
```

## 环境要求

- Node.js >= 16
- 支持浏览器和 Web Workers

## 高级用法

### 动态加载字体和表情符号

```javascript
const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: [...],
  loadAdditionalAsset: async (code, segment) => {
    if (code === 'emoji') {
      // 加载表情符号图片
      return `data:image/svg+xml;base64,...`
    }
    
    // 加载动态字体
    return loadFontFromSystem(code)
  }
})
```

### 多语言支持

```javascript
const svg = await satori(dom, {
    width: 600,
    height: 400,
    fonts: [
      {
      name: 'Noto Sans CJK',
      data: notoSansCJK,
        weight: 400,
        style: 'normal',
      lang: 'zh-CN'
    }
  ]
})
```

### 调试模式

```javascript
const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: [...],
  debug: true // 启用调试模式，显示元素边界
})
```

## 性能优化

### 字体缓存

```javascript
// 全局定义字体，避免重复创建
const fonts = [
  {
    name: 'Roboto',
    data: robotoArrayBuffer,
    weight: 400,
    style: 'normal',
  }
]

// 在多个渲染中复用
const svg1 = await satori(dom1, { fonts, width: 600, height: 400 })
const svg2 = await satori(dom2, { fonts, width: 600, height: 400 })
```

### 图片优化

使用 base64 编码的图片数据而不是 URL，避免额外的 I/O 操作：

```javascript
<img src="data:image/png;base64,..." width={200} height={300} />
```

## 限制

1. **不支持交互元素**: `<input>`, `<button>` 等
2. **不支持动画**: CSS 动画和过渡
3. **不支持 JavaScript**: 无法执行脚本
4. **不支持外部资源**: 无法加载外部样式表或脚本
5. **不支持 3D 变换**: 只支持 2D 变换
6. **不支持 z-index**: SVG 中元素按文档顺序绘制
7. **CSS 属性限制**:
   - `overflow`: 只支持 `visible` 和 `hidden`，不支持 `scroll` 和 `auto`
   - `border-style`: 只支持 `solid` 和 `dashed`，不支持 `dotted`、`double` 等
   - `display`: 不支持 CSS Grid 布局 (`grid`)，只支持 `flex`、`block`、`none`、`-webkit-box`

## 贡献

欢迎贡献代码！请查看 [贡献指南](CONTRIBUTING.md) 了解详细信息。

## 许可证

MPL-2.0