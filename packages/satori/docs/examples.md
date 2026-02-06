# Satori 使用示例

本文档提供了 Satori 的各种使用示例，从基础用法到高级应用场景。

## 基础示例

### 1. 简单的文本渲染

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

### 2. 带样式的卡片

```javascript
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 300px;
    height: 200px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 15px;
    padding: 20px;
    color: white;
    font-family: 'Roboto', sans-serif;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  ">
    <h1 style="margin: 0; text-align: center;">欢迎使用 Satori</h1>
  </div>
</body>
</html>
`)

const svg = await satori(dom, {
  width: 340,
  height: 240,
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

### 3. 响应式布局

```javascript
const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 20px;
    background: #f8f9fa;
  ">
    <header style="
      background: white;
      padding: 15px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    ">
      <h1 style="margin: 0; color: #333;">页面标题</h1>
    </header>
    
    <main style="
      flex: 1;
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    ">
      <p style="margin: 0 0 15px 0; color: #666;">
        这是主要内容区域，支持响应式布局。
      </p>
      <div style="
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      ">
        <div style="
          flex: 1;
          min-width: 150px;
          background: #e3f2fd;
          padding: 15px;
          border-radius: 6px;
          text-align: center;
        ">
          卡片 1
        </div>
        <div style="
          flex: 1;
          min-width: 150px;
          background: #f3e5f5;
          padding: 15px;
          border-radius: 6px;
          text-align: center;
        ">
          卡片 2
        </div>
      </div>
    </main>
  </div>
</body>
</html>
`)

const svg = await satori(dom, {
  width: 800,
  height: 600,
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

## 高级示例

### 4. 数据可视化卡片

```javascript
const createDataCard = (data) => {
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 400px;
    height: 300px;
    background: white;
    border-radius: 12px;
    padding: 24px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    font-family: 'Roboto', sans-serif;
  ">
    <div style="
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    ">
      <h2 style="margin: 0; color: #333; font-size: 20px;">${data.title}</h2>
      <div style="
        background: ${data.trend > 0 ? '#4caf50' : '#f44336'};
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: bold;
      ">
        ${data.trend > 0 ? '+' : ''}${data.trend}%
      </div>
    </div>
    
    <div style="
      font-size: 36px;
      font-weight: bold;
      color: #2196f3;
      margin-bottom: 20px;
    ">
      ${data.value.toLocaleString()}
    </div>
    
    <div style="
      display: flex;
      justify-content: space-between;
      color: #666;
      font-size: 14px;
    ">
      <span>目标: ${data.target.toLocaleString()}</span>
      <span>完成率: ${Math.round((data.value / data.target) * 100)}%</span>
    </div>
    
    <div style="
      margin-top: 20px;
      height: 8px;
      background: #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    ">
      <div style="
        width: ${(data.value / data.target) * 100}%;
        height: 100%;
        background: linear-gradient(90deg, #2196f3, #21cbf3);
        transition: width 0.3s ease;
      "></div>
    </div>
  </div>
</body>
</html>
`)

  return satori(dom, {
    width: 448,
    height: 348,
    fonts: [
      {
        name: 'Roboto',
        data: robotoArrayBuffer,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Roboto',
        data: robotoBoldArrayBuffer,
        weight: 700,
        style: 'normal',
      },
    ],
  })
}

// 使用示例
const data = {
  title: '月度销售额',
  value: 125000,
  target: 150000,
  trend: 12.5
}

const svg = await createDataCard(data)
```

### 5. 社交媒体分享图片

```javascript
const createSocialShareImage = (post) => {
  const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 1200px;
    height: 630px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 60px;
    font-family: 'Roboto', sans-serif;
    color: white;
  ">
    <div style="
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 40px;
      text-align: center;
      max-width: 800px;
    ">
      <h1 style="
        margin: 0 0 20px 0;
        font-size: 48px;
        font-weight: bold;
        line-height: 1.2;
      ">
        ${post.title}
      </h1>
      
      <p style="
        margin: 0 0 30px 0;
        font-size: 24px;
        line-height: 1.5;
        opacity: 0.9;
      ">
        ${post.excerpt}
      </p>
      
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 15px;
      ">
        <div style="
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: rgba(255,255,255,0.2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
        ">
          👤
        </div>
        <div>
          <div style="font-size: 18px; font-weight: bold;">${post.author}</div>
          <div style="font-size: 14px; opacity: 0.8;">${post.date}</div>
        </div>
      </div>
    </div>
    
    <div style="
      position: absolute;
      bottom: 40px;
      right: 40px;
      font-size: 16px;
      opacity: 0.7;
    ">
      #Satori #分享图片
    </div>
  </div>
</body>
</html>
`)

  return satori(dom, {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Roboto',
        data: robotoArrayBuffer,
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Roboto',
        data: robotoBoldArrayBuffer,
        weight: 700,
        style: 'normal',
      },
    ],
  })
}

// 使用示例
const post = {
  title: '使用 Satori 创建精美的分享图片',
  excerpt: '学习如何使用 Satori 将 HTML 和 CSS 转换为高质量的 SVG 图像，为你的应用添加专业的图片生成功能。',
  author: '张三',
  date: '2024年1月15日'
}

const svg = await createSocialShareImage(post)
```

### 6. 多语言支持

```javascript
const createMultilingualCard = (content, locale) => {
  const dom = new JSDOM(`
<!DOCTYPE html>
<html lang="${locale}">
<body>
  <div style="
    width: 500px;
    height: 300px;
    background: white;
    border-radius: 12px;
    padding: 30px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    font-family: ${locale === 'zh-CN' ? 'Noto Sans CJK' : 'Roboto'}, sans-serif;
  ">
    <h1 style="
      margin: 0 0 20px 0;
      color: #333;
      font-size: 28px;
      text-align: center;
    ">
      ${content.title}
    </h1>
    
    <p style="
      margin: 0 0 30px 0;
      color: #666;
      font-size: 16px;
      line-height: 1.6;
      text-align: center;
    ">
      ${content.description}
    </p>
    
    <div style="
      display: flex;
      justify-content: center;
      gap: 20px;
    ">
      <button style="
        background: #2196f3;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 6px;
        font-size: 16px;
        cursor: pointer;
      ">
        ${content.primaryButton}
      </button>
      
      <button style="
        background: transparent;
        color: #2196f3;
        border: 2px solid #2196f3;
        padding: 10px 22px;
        border-radius: 6px;
        font-size: 16px;
        cursor: pointer;
      ">
        ${content.secondaryButton}
      </button>
    </div>
  </div>
</body>
</html>
`)

  const fonts = [
    {
      name: 'Roboto',
      data: robotoArrayBuffer,
      weight: 400,
      style: 'normal',
    }
  ]

  // 根据语言添加相应字体
  if (locale === 'zh-CN') {
    fonts.push({
      name: 'Noto Sans CJK',
      data: notoSansCJKArrayBuffer,
      weight: 400,
      style: 'normal',
      lang: 'zh-CN'
    })
  } else if (locale === 'ja') {
    fonts.push({
      name: 'Noto Sans JP',
      data: notoSansJPArrayBuffer,
      weight: 400,
      style: 'normal',
      lang: 'ja'
    })
  }

  return satori(dom, {
    width: 560,
    height: 360,
    fonts,
  })
}

// 使用示例
const content = {
  zh: {
    title: '欢迎使用我们的服务',
    description: '这是一个功能强大的工具，可以帮助您创建精美的图像。',
    primaryButton: '开始使用',
    secondaryButton: '了解更多'
  },
  en: {
    title: 'Welcome to Our Service',
    description: 'This is a powerful tool that helps you create beautiful images.',
    primaryButton: 'Get Started',
    secondaryButton: 'Learn More'
  },
  ja: {
    title: 'サービスへようこそ',
    description: 'これは美しい画像を作成するのに役立つ強力なツールです。',
    primaryButton: '始める',
    secondaryButton: '詳細を見る'
  }
}

const svgZh = await createMultilingualCard(content.zh, 'zh-CN')
const svgEn = await createMultilingualCard(content.en, 'en')
const svgJa = await createMultilingualCard(content.ja, 'ja')
```

### 7. 动态内容生成

```javascript
const createDynamicContent = async (template, data) => {
  // 动态替换模板中的变量
  let html = template
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g')
    html = html.replace(regex, value)
  }

  const dom = new JSDOM(html)

  return satori(dom, {
    width: 800,
    height: 600,
    fonts: [
      {
        name: 'Roboto',
        data: robotoArrayBuffer,
        weight: 400,
        style: 'normal',
      },
    ],
  })
}

// 使用示例
const template = `
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 100%;
    height: 100%;
    background: {{backgroundColor}};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    font-family: 'Roboto', sans-serif;
  ">
    <h1 style="
      margin: 0 0 20px 0;
      color: {{titleColor}};
      font-size: 36px;
      text-align: center;
    ">
      {{title}}
    </h1>
    
    <p style="
      margin: 0;
      color: {{textColor}};
      font-size: 18px;
      text-align: center;
      max-width: 500px;
    ">
      {{description}}
    </p>
    
    {{#if showButton}}
    <button style="
      margin-top: 30px;
      background: {{buttonColor}};
      color: white;
      border: none;
      padding: 15px 30px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
    ">
      {{buttonText}}
    </button>
    {{/if}}
  </div>
</body>
</html>
`

const data = {
  title: '动态内容生成',
  description: '这是一个使用模板和动态数据生成内容的示例。',
  backgroundColor: '#f0f8ff',
  titleColor: '#2c3e50',
  textColor: '#34495e',
  showButton: true,
  buttonText: '点击这里',
  buttonColor: '#3498db'
}

const svg = await createDynamicContent(template, data)
```

## 实用工具函数

### 8. 批量生成工具

```javascript
class SatoriBatchProcessor {
  constructor(fonts) {
    this.fonts = fonts
    this.cache = new Map()
  }

  async processBatch(templates, options = {}) {
    const results = []
    
    for (const template of templates) {
      try {
        const svg = await this.processTemplate(template, options)
        results.push({ success: true, svg, template })
      } catch (error) {
        results.push({ success: false, error: error.message, template })
      }
    }
    
    return results
  }

  async processTemplate(template, options = {}) {
    const cacheKey = JSON.stringify({ template, options })
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)
    }

    const dom = new JSDOM(template.html)
    const svg = await satori(dom, {
      width: template.width || 800,
      height: template.height || 600,
      fonts: this.fonts,
      ...options
    })

    this.cache.set(cacheKey, svg)
    return svg
  }

  clearCache() {
    this.cache.clear()
  }
}

// 使用示例
const processor = new SatoriBatchProcessor([
  {
    name: 'Roboto',
    data: robotoArrayBuffer,
    weight: 400,
    style: 'normal',
  }
])

const templates = [
  {
    html: '<div style="background: red; width: 100%; height: 100%;">模板1</div>',
    width: 400,
    height: 300
  },
  {
    html: '<div style="background: blue; width: 100%; height: 100%;">模板2</div>',
    width: 600,
    height: 400
  }
]

const results = await processor.processBatch(templates)
```

### 9. 错误处理和重试机制

```javascript
const createSatoriWithRetry = async (dom, options, maxRetries = 3) => {
  let lastError

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await satori(dom, options)
    } catch (error) {
      lastError = error
      console.warn(`Satori 转换失败 (尝试 ${attempt}/${maxRetries}):`, error.message)
      
      if (attempt < maxRetries) {
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
      }
    }
  }

  throw new Error(`Satori 转换失败，已重试 ${maxRetries} 次: ${lastError.message}`)
}

// 使用示例
try {
  const svg = await createSatoriWithRetry(dom, options)
  console.log('转换成功:', svg)
} catch (error) {
  console.error('转换最终失败:', error)
}
```

这些示例展示了 Satori 的各种使用场景，从简单的文本渲染到复杂的动态内容生成。你可以根据具体需求选择合适的示例进行参考和修改。 