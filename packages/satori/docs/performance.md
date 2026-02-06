# Satori 性能优化指南

本文档提供了 Satori 的性能优化策略和最佳实践，帮助你获得最佳的转换性能。

## 性能基准

### 典型性能指标

基于测试环境（Node.js 16+, 8GB RAM）的性能基准：

| 场景 | 复杂度 | 平均耗时 | 内存使用 |
|------|--------|----------|----------|
| 简单文本 | 低 | 50-100ms | 10-20MB |
| 基础布局 | 中 | 100-300ms | 20-50MB |
| 复杂样式 | 高 | 300-800ms | 50-100MB |
| 大量元素 | 很高 | 800ms-2s | 100-200MB |

### 性能影响因素

1. **DOM 复杂度**: 元素数量和嵌套深度
2. **样式复杂度**: CSS 属性数量和复杂度
3. **字体数量**: 加载的字体文件大小和数量
4. **图片资源**: 外部图片的数量和大小
5. **内存管理**: 缓存策略和垃圾回收

## 优化策略

### 1. 字体优化

#### 字体缓存

```javascript
// ❌ 错误：每次都创建新的字体对象
const svg1 = await satori(dom1, {
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

const svg2 = await satori(dom2, {
  width: 600,
  height: 400,
  fonts: [
    {
      name: 'Roboto',
      data: robotoArrayBuffer, // 重复创建
      weight: 400,
      style: 'normal',
    },
  ],
})

// ✅ 正确：全局定义字体，复用字体对象
const fonts = [
  {
    name: 'Roboto',
    data: robotoArrayBuffer,
    weight: 400,
    style: 'normal',
  }
]

const svg1 = await satori(dom1, { width: 600, height: 400, fonts })
const svg2 = await satori(dom2, { width: 600, height: 400, fonts })
```

#### 字体预加载

```javascript
// 预加载常用字体
class FontManager {
  constructor() {
    this.fonts = new Map()
    this.loading = new Map()
  }

  async loadFont(name, url) {
    if (this.fonts.has(name)) {
      return this.fonts.get(name)
    }

    if (this.loading.has(name)) {
      return this.loading.get(name)
    }

    const loadPromise = fetch(url)
      .then(response => response.arrayBuffer())
      .then(data => {
        const font = { name, data, weight: 400, style: 'normal' }
        this.fonts.set(name, font)
        this.loading.delete(name)
        return font
      })

    this.loading.set(name, loadPromise)
    return loadPromise
  }

  getFonts() {
    return Array.from(this.fonts.values())
  }
}

// 使用示例
const fontManager = new FontManager()
await fontManager.loadFont('Roboto', '/fonts/Roboto-Regular.ttf')
await fontManager.loadFont('Noto Sans CJK', '/fonts/NotoSansCJK-Regular.ttf')

const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: fontManager.getFonts()
})
```

#### 字体子集化

```javascript
// 只加载需要的字符，减少字体文件大小
const createFontSubset = async (fontData, characters) => {
  // 使用 fonttools 或其他工具创建字体子集
  const subsetData = await createFontSubset(fontData, characters)
  return subsetData
}

// 使用示例
const commonChars = '你好世界HelloWorld0123456789'
const subsetFont = await createFontSubset(robotoData, commonChars)

const svg = await satori(dom, {
  width: 600,
  height: 400,
  fonts: [
    {
      name: 'Roboto',
      data: subsetFont, // 更小的字体文件
      weight: 400,
      style: 'normal',
    }
  ]
})
```

### 2. DOM 优化

#### 简化 DOM 结构

```javascript
// ❌ 错误：复杂的 DOM 结构
const complexDom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div>
    <div>
      <div>
        <div>
          <div>
            <div>
              <div>
                <div>
                  <div>
                    <div>
                      <span>文本内容</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`)

// ✅ 正确：简化的 DOM 结构
const simpleDom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div>
    <span>文本内容</span>
  </div>
</body>
</html>
`)
```

#### 批量处理

```javascript
// 批量处理多个 DOM，减少重复初始化开销
const processBatch = async (doms, options) => {
  const results = []
  
  // 并行处理，但限制并发数
  const batchSize = 5
  for (let i = 0; i < doms.length; i += batchSize) {
    const batch = doms.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(dom => satori(dom, options))
    )
    results.push(...batchResults)
  }
  
  return results
}

// 使用示例
const doms = [dom1, dom2, dom3, dom4, dom5, dom6, dom7, dom8]
const results = await processBatch(doms, {
  width: 600,
  height: 400,
  fonts: commonFonts
})
```

### 3. 样式优化

#### 避免复杂样式

```javascript
// ❌ 错误：过于复杂的样式
const complexStyles = `
  background: linear-gradient(45deg, 
    rgba(255,0,0,0.1) 0%, 
    rgba(0,255,0,0.1) 25%, 
    rgba(0,0,255,0.1) 50%, 
    rgba(255,255,0,0.1) 75%, 
    rgba(255,0,255,0.1) 100%
  );
  box-shadow: 
    0 1px 3px rgba(0,0,0,0.12), 
    0 1px 2px rgba(0,0,0,0.24),
    0 3px 6px rgba(0,0,0,0.16),
    0 4px 8px rgba(0,0,0,0.08);
  transform: 
    rotate(5deg) 
    scale(1.1) 
    translateX(10px) 
    translateY(-5px) 
    skewX(2deg) 
    skewY(1deg);
`

// ✅ 正确：简化的样式
const simpleStyles = `
  background: #f0f0f0;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transform: rotate(5deg);
`
```

#### 使用 CSS 简写属性

```javascript
// ❌ 错误：分别设置各个属性
const separateStyles = `
  margin-top: 10px;
  margin-right: 20px;
  margin-bottom: 10px;
  margin-left: 20px;
  padding-top: 15px;
  padding-right: 25px;
  padding-bottom: 15px;
  padding-left: 25px;
`

// ✅ 正确：使用简写属性
const shorthandStyles = `
  margin: 10px 20px;
  padding: 15px 25px;
`
```

### 4. 内存管理

#### 及时清理 DOM

```javascript
// 处理大量转换时，及时清理内存
const processLargeBatch = async (doms, options) => {
  const results = []
  
  for (const dom of doms) {
    try {
      const svg = await satori(dom, options)
      results.push(svg)
    } finally {
      // 清理 DOM 引用，帮助垃圾回收
      dom.window.close()
    }
  }
  
  return results
}
```

#### 使用对象池

```javascript
// 对象池模式，复用 JSDOM 实例
class DomPool {
  constructor(size = 10) {
    this.pool = []
    this.size = size
  }

  async get() {
    if (this.pool.length > 0) {
      return this.pool.pop()
    }
    
    // 创建新的 JSDOM 实例
    return new JSDOM('<!DOCTYPE html><html><body></body></html>')
  }

  release(dom) {
    if (this.pool.length < this.size) {
      // 清理 DOM 内容
      dom.window.document.body.innerHTML = ''
      this.pool.push(dom)
    } else {
      // 池已满，直接关闭
      dom.window.close()
    }
  }
}

// 使用示例
const domPool = new DomPool(5)

const processWithPool = async (htmlContents, options) => {
  const results = []
  
  for (const html of htmlContents) {
    const dom = await domPool.get()
    try {
      dom.window.document.body.innerHTML = html
      const svg = await satori(dom, options)
      results.push(svg)
    } finally {
      domPool.release(dom)
    }
  }
  
  return results
}
```

### 5. 缓存策略

#### 结果缓存

```javascript
class SatoriCache {
  constructor(maxSize = 100) {
    this.cache = new Map()
    this.maxSize = maxSize
  }

  getKey(dom, options) {
    // 创建缓存键，基于 DOM 内容和选项
    const html = dom.window.document.body.innerHTML
    const optionsKey = JSON.stringify({
      width: options.width,
      height: options.height,
      fonts: options.fonts?.map(f => f.name)
    })
    return `${html}_${optionsKey}`
  }

  get(dom, options) {
    const key = this.getKey(dom, options)
    return this.cache.get(key)
  }

  set(dom, options, svg) {
    const key = this.getKey(dom, options)
    
    // LRU 缓存策略
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
    
    this.cache.set(key, svg)
  }

  clear() {
    this.cache.clear()
  }
}

// 使用示例
const cache = new SatoriCache()

const satoriWithCache = async (dom, options) => {
  const cached = cache.get(dom, options)
  if (cached) {
    return cached
  }
  
  const svg = await satori(dom, options)
  cache.set(dom, options, svg)
  return svg
}
```

#### 模板缓存

```javascript
// 缓存常用的 HTML 模板
class TemplateCache {
  constructor() {
    this.templates = new Map()
  }

  register(name, template) {
    this.templates.set(name, template)
  }

  render(name, data) {
    const template = this.templates.get(name)
    if (!template) {
      throw new Error(`Template ${name} not found`)
    }
    
    let html = template
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
      html = html.replace(regex, value)
    }
    
    return new JSDOM(html)
  }
}

// 使用示例
const templateCache = new TemplateCache()

templateCache.register('card', `
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 300px;
    height: 200px;
    background: {{backgroundColor}};
    padding: 20px;
    border-radius: 10px;
  ">
    <h2>{{title}}</h2>
    <p>{{content}}</p>
  </div>
</body>
</html>
`)

const dom = templateCache.render('card', {
  backgroundColor: '#f0f0f0',
  title: '标题',
  content: '内容'
})

const svg = await satori(dom, options)
```

## 性能监控

### 性能指标收集

```javascript
class PerformanceMonitor {
  constructor() {
    this.metrics = []
  }

  async measure(name, fn) {
    const startTime = performance.now()
    const startMemory = process.memoryUsage()
    
    try {
      const result = await fn()
      
      const endTime = performance.now()
      const endMemory = process.memoryUsage()
      
      const metric = {
        name,
        duration: endTime - startTime,
        memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
        timestamp: new Date().toISOString()
      }
      
      this.metrics.push(metric)
      return result
    } catch (error) {
      const endTime = performance.now()
      const metric = {
        name,
        duration: endTime - startTime,
        error: error.message,
        timestamp: new Date().toISOString()
      }
      
      this.metrics.push(metric)
      throw error
    }
  }

  getStats() {
    const successful = this.metrics.filter(m => !m.error)
    
    if (successful.length === 0) {
      return { error: 'No successful metrics' }
    }
    
    const durations = successful.map(m => m.duration)
    const memoryDeltas = successful.map(m => m.memoryDelta)
    
    return {
      count: successful.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      avgMemoryDelta: memoryDeltas.reduce((a, b) => a + b, 0) / memoryDeltas.length,
      errorRate: this.metrics.filter(m => m.error).length / this.metrics.length
    }
  }

  clear() {
    this.metrics = []
  }
}

// 使用示例
const monitor = new PerformanceMonitor()

const svg = await monitor.measure('satori-conversion', () =>
  satori(dom, options)
)

console.log('性能统计:', monitor.getStats())
```

### 性能基准测试

```javascript
const runBenchmark = async (testCases, options) => {
  const results = []
  
  for (const testCase of testCases) {
    const { name, dom, expectedDuration } = testCase
    
    const startTime = performance.now()
    const startMemory = process.memoryUsage()
    
    try {
      const svg = await satori(dom, options)
      
      const endTime = performance.now()
      const endMemory = process.memoryUsage()
      
      const duration = endTime - startTime
      const memoryDelta = endMemory.heapUsed - startMemory.heapUsed
      
      results.push({
        name,
        duration,
        memoryDelta,
        success: true,
        withinExpected: duration <= expectedDuration
      })
    } catch (error) {
      results.push({
        name,
        error: error.message,
        success: false
      })
    }
  }
  
  return results
}

// 使用示例
const testCases = [
  {
    name: '简单文本',
    dom: new JSDOM('<div>Hello World</div>'),
    expectedDuration: 100
  },
  {
    name: '复杂布局',
    dom: new JSDOM(complexHtml),
    expectedDuration: 500
  }
]

const benchmarkResults = await runBenchmark(testCases, {
  width: 600,
  height: 400,
  fonts: commonFonts
})

console.log('基准测试结果:', benchmarkResults)
```

## 最佳实践总结

### 1. 字体管理
- ✅ 全局定义字体，避免重复创建
- ✅ 使用字体子集化减少文件大小
- ✅ 预加载常用字体

### 2. DOM 优化
- ✅ 简化 DOM 结构，减少嵌套层级
- ✅ 批量处理多个转换
- ✅ 及时清理 DOM 引用

### 3. 样式优化
- ✅ 使用简化的 CSS 样式
- ✅ 避免过于复杂的渐变和变换
- ✅ 使用 CSS 简写属性

### 4. 内存管理
- ✅ 使用对象池复用 JSDOM 实例
- ✅ 及时清理不需要的引用
- ✅ 监控内存使用情况

### 5. 缓存策略
- ✅ 缓存转换结果
- ✅ 缓存常用模板
- ✅ 使用 LRU 缓存策略

### 6. 性能监控
- ✅ 收集性能指标
- ✅ 运行基准测试
- ✅ 监控错误率

通过遵循这些优化策略，你可以显著提升 Satori 的性能，特别是在处理大量转换或复杂内容时。 