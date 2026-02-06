# Satori API 文档

## 概述

Satori 是一个强大的库，用于将 HTML 和 CSS 转换为高质量的 SVG 图像。本文档详细介绍了 Satori 的 API 接口、类型定义和使用方法。

## 核心 API

### `satori(dom, options)`

将 JSDOM 对象转换为 SVG 字符串。

#### 参数

- `dom` (JSDOM): JSDOM 实例，包含要转换的 HTML 内容
- `options` (SatoriOptions): 配置选项

#### 返回值

- `Promise<string>`: 生成的 SVG 字符串

#### 示例

```javascript
import satori from '@zhinjs/satori'
import { JSDOM } from 'jsdom'

const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="color: black; padding: 20px; background: #f0f0f0;">
    Hello, World!
  </div>
</body>
</html>
`)

const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: [
    {
      name: 'Roboto',
      data: robotoArrayBuffer,
      weight: 400,
      style: 'normal',
    },
  ],
})
```

## 类型定义

### SatoriOptions

主要的配置选项类型。

```typescript
type SatoriOptions = (
  | {
      width: number
      height: number
    }
  | {
      width: number
    }
  | {
      height: number
    }
) & {
  fonts: FontOptions[]
  embedFont?: boolean
  debug?: boolean
  graphemeImages?: Record<string, string>
  loadAdditionalAsset?: (
    languageCode: string,
    segment: string
  ) => Promise<string | Array<FontOptions>>
  tailwindConfig?: TwConfig
  onNodeDetected?: (node: SatoriNode) => void
  pointScaleFactor?: number
}
```

#### 属性说明

- **width/height**: 输出 SVG 的尺寸（至少需要指定一个）
- **fonts**: 字体配置数组
- **embedFont**: 是否在 SVG 中嵌入字体（默认 false）
- **debug**: 是否启用调试模式，显示元素边界（默认 false）
- **graphemeImages**: 字符到图片的映射，用于表情符号等特殊字符
- **loadAdditionalAsset**: 动态加载资源的回调函数
- **tailwindConfig**: Tailwind CSS 配置
- **onNodeDetected**: 节点检测回调函数
- **pointScaleFactor**: 点缩放因子（默认 1）

### FontOptions

字体配置选项。

```typescript
interface FontOptions {
  name: string
  data: ArrayBuffer
  weight?: number
  style?: 'normal' | 'italic'
  lang?: string
}
```

#### 属性说明

- **name**: 字体名称
- **data**: 字体文件数据（ArrayBuffer）
- **weight**: 字体粗细（默认 400）
- **style**: 字体样式（默认 'normal'）
- **lang**: 字体语言代码

### SatoriNode

Satori 内部节点类型。

```typescript
interface SatoriNode {
  id: string
  type: 'element' | 'text'
  tagName?: string
  textContent?: string
  style: Record<string, any>
  children?: SatoriNode[]
}
```

## 高级用法

### 动态加载字体

```javascript
const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: [
    {
      name: 'Roboto',
      data: robotoArrayBuffer,
      weight: 400,
      style: 'normal',
    },
  ],
  loadAdditionalAsset: async (languageCode, segment) => {
    if (languageCode === 'emoji') {
      // 加载表情符号图片
      return `data:image/svg+xml;base64,${base64Data}`
    }
    
    // 动态加载字体
    const fontData = await fetch(`/fonts/${segment}.ttf`).then(r => r.arrayBuffer())
    return {
      name: segment,
      data: fontData,
      weight: 400,
      style: 'normal',
    }
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
    },
    {
      name: 'Noto Sans JP',
      data: notoSansJP,
      weight: 400,
      style: 'normal',
      lang: 'ja'
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
  debug: true, // 显示元素边界
  onNodeDetected: (node) => {
    console.log('检测到节点:', node)
  }
})
```

### 表情符号支持

```javascript
const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: [...],
  graphemeImages: {
    '😀': 'data:image/svg+xml;base64,...',
    '🎉': 'data:image/svg+xml;base64,...',
  }
})
```

## 错误处理

### 常见错误

1. **字体未找到**
   ```javascript
   // 错误: 文本使用了未加载的字体
   // 解决: 确保所有使用的字体都在 fonts 数组中
   ```

2. **Yoga 未初始化**
   ```javascript
   // 错误: Satori is not initialized: expect `yoga` to be loaded
   // 解决: 确保正确导入和初始化
   ```

3. **无效的 CSS 属性**
   ```javascript
   // 错误: Invalid value for CSS property "textAlign"
   // 解决: 检查 CSS 属性值是否在支持范围内
   ```

### 错误处理最佳实践

```javascript
try {
  const svg = await satori(dom, options)
  return svg
} catch (error) {
  console.error('Satori 转换失败:', error)
  
  // 根据错误类型进行不同处理
  if (error.message.includes('font')) {
    // 处理字体相关错误
    return fallbackSvg
  } else if (error.message.includes('CSS')) {
    // 处理 CSS 相关错误
    return simplifiedSvg
  } else {
    // 处理其他错误
    throw error
  }
}
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

// 在多个转换中复用
const svg1 = await satori(dom1, { width: 600, height: 400, fonts })
const svg2 = await satori(dom2, { width: 600, height: 400, fonts })
```

### 批量处理

```javascript
// 批量处理多个 DOM
const results = await Promise.all(
  doms.map(dom => satori(dom, options))
)
```

### 内存管理

```javascript
// 处理大量转换时，及时清理内存
for (const dom of doms) {
  const svg = await satori(dom, options)
  // 处理 SVG...
  
  // 清理 DOM 引用
  dom.window.close()
}
```

## 限制说明

### 不支持的 HTML 元素

- 交互元素：`<input>`, `<button>`, `<select>`, `<textarea>` 等
- 媒体元素：`<video>`, `<audio>`, `<canvas>` 等
- 表单元素：`<form>`, `<fieldset>`, `<legend>` 等

### 不支持的 CSS 属性

- `overflow`: 只支持 `visible` 和 `hidden`，不支持 `scroll` 和 `auto`
- `border-style`: 只支持 `solid` 和 `dashed`，不支持 `dotted`、`double` 等
- `display`: 不支持 CSS Grid 布局 (`grid`)，只支持 `flex`、`block`、`none`、`-webkit-box`

### 其他限制

- 不支持 CSS 动画和过渡
- 不支持 JavaScript 执行
- 不支持外部资源加载
- 不支持 3D 变换
- 不支持 z-index（SVG 中元素按文档顺序绘制）

## 最佳实践

### 1. 字体管理

```javascript
// 预加载常用字体
const commonFonts = [
  { name: 'Roboto', data: robotoData, weight: 400, style: 'normal' },
  { name: 'Noto Sans CJK', data: notoSansCJK, weight: 400, style: 'normal' }
]

// 根据内容动态添加字体
const getFontsForContent = (content) => {
  const fonts = [...commonFonts]
  
  if (content.includes('emoji')) {
    fonts.push({ name: 'Emoji', data: emojiFontData, weight: 400, style: 'normal' })
  }
  
  return fonts
}
```

### 2. 错误恢复

```javascript
const convertWithFallback = async (dom, options) => {
  try {
    return await satori(dom, options)
  } catch (error) {
    console.warn('转换失败，使用简化版本:', error)
    
    // 移除可能导致问题的样式
    const simplifiedDom = simplifyStyles(dom)
    return await satori(simplifiedDom, options)
  }
}
```

### 3. 性能监控

```javascript
const convertWithMetrics = async (dom, options) => {
  const startTime = performance.now()
  const startMemory = process.memoryUsage()
  
  try {
    const svg = await satori(dom, options)
    
    const endTime = performance.now()
    const endMemory = process.memoryUsage()
    
    console.log(`转换耗时: ${endTime - startTime}ms`)
    console.log(`内存使用: ${endMemory.heapUsed - startMemory.heapUsed} bytes`)
    
    return svg
  } catch (error) {
    console.error('转换失败:', error)
    throw error
  }
}
``` 