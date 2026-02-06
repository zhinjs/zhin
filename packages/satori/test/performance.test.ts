import { it, describe, expect, beforeAll, afterAll } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts } from './utils.js'
import satori from '../src/index.js'

describe('性能基准测试', () => {
  let fonts
  let performanceMetrics = []

  initFonts((f) => (fonts = f))

  beforeAll(() => {
    // 清理之前的性能指标
    performanceMetrics = []
  })

  afterAll(() => {
    // 输出性能统计
    console.log('\n=== 性能基准测试结果 ===')
    const stats = calculatePerformanceStats(performanceMetrics)
    console.log('总体统计:', stats)
    
    // 输出详细指标
    performanceMetrics.forEach(metric => {
      console.log(`${metric.name}: ${metric.duration.toFixed(2)}ms, ${metric.memoryDelta} bytes`)
    })
  })

  const measurePerformance = async (name, testFn) => {
    const startTime = performance.now()
    const startMemory = process.memoryUsage()
    
    try {
      const result = await testFn()
      
      const endTime = performance.now()
      const endMemory = process.memoryUsage()
      
      const metric = {
        name,
        duration: endTime - startTime,
        memoryDelta: endMemory.heapUsed - startMemory.heapUsed,
        success: true
      }
      
      performanceMetrics.push(metric)
      return result
    } catch (error) {
      const endTime = performance.now()
      const metric = {
        name,
        duration: endTime - startTime,
        error: error.message,
        success: false
      }
      
      performanceMetrics.push(metric)
      throw error
    }
  }

  const calculatePerformanceStats = (metrics) => {
    const successful = metrics.filter(m => m.success)
    
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
      errorRate: metrics.filter(m => !m.success).length / metrics.length
    }
  }

  describe('基础性能测试', () => {
    it('简单文本渲染性能', async () => {
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

      const svg = await measurePerformance('简单文本渲染', () =>
        satori(dom, {
          width: 600,
          height: 400,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('基础布局性能', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px;
    background: #f8f9fa;
  ">
    <header style="background: white; padding: 15px; border-radius: 8px;">
      <h1 style="margin: 0; color: #333;">页面标题</h1>
    </header>
    
    <main style="
      flex: 1;
      background: white;
      padding: 20px;
      border-radius: 8px;
    ">
      <p style="margin: 0 0 15px 0; color: #666;">
        这是主要内容区域，支持响应式布局。
      </p>
      <div style="display: flex; gap: 10px;">
        <div style="
          flex: 1;
          background: #e3f2fd;
          padding: 15px;
          border-radius: 6px;
          text-align: center;
        ">
          卡片 1
        </div>
        <div style="
          flex: 1;
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

      const svg = await measurePerformance('基础布局', () =>
        satori(dom, {
          width: 800,
          height: 600,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('复杂样式性能', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 100%;
    height: 100%;
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
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      transform: rotate(2deg) scale(1.02);
    ">
      <h1 style="
        margin: 0 0 20px 0;
        font-size: 48px;
        font-weight: bold;
        line-height: 1.2;
        text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
      ">
        欢迎使用 Satori
      </h1>
      
      <p style="
        margin: 0 0 30px 0;
        font-size: 24px;
        line-height: 1.5;
        opacity: 0.9;
      ">
        学习如何使用 Satori 将 HTML 和 CSS 转换为高质量的 SVG 图像
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
          <div style="font-size: 18px; font-weight: bold;">张三</div>
          <div style="font-size: 14px; opacity: 0.8;">2024年1月15日</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
      `)

      const svg = await measurePerformance('复杂样式', () =>
        satori(dom, {
          width: 1200,
          height: 630,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('批量处理性能', () => {
    it('小批量处理性能', async () => {
      const templates = [
        '<div style="background: red; padding: 20px;">模板 1</div>',
        '<div style="background: blue; padding: 20px;">模板 2</div>',
        '<div style="background: green; padding: 20px;">模板 3</div>',
        '<div style="background: yellow; padding: 20px;">模板 4</div>',
        '<div style="background: purple; padding: 20px;">模板 5</div>'
      ]

      const results = await measurePerformance('小批量处理(5个)', async () => {
        const svgs = []
        for (const template of templates) {
          const dom = new JSDOM(template)
          const svg = await satori(dom, {
            width: 400,
            height: 300,
            fonts
          })
          svgs.push(svg)
        }
        return svgs
      })

      expect(results).toHaveLength(5)
      results.forEach(svg => {
        expect(svg).toBeDefined()
        expect(svg).toContain('<svg')
      })
    })

    it('中批量处理性能', async () => {
      const templates = []
      for (let i = 0; i < 20; i++) {
        templates.push(`
          <div style="
            background: hsl(${i * 18}, 70%, 60%);
            padding: 20px;
            border-radius: 10px;
            margin: 10px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          ">
            模板 ${i + 1}
          </div>
        `)
      }

      const results = await measurePerformance('中批量处理(20个)', async () => {
        const svgs = []
        for (const template of templates) {
          const dom = new JSDOM(template)
          const svg = await satori(dom, {
            width: 400,
            height: 300,
            fonts
          })
          svgs.push(svg)
        }
        return svgs
      })

      expect(results).toHaveLength(20)
      results.forEach(svg => {
        expect(svg).toBeDefined()
        expect(svg).toContain('<svg')
      })
    })

    it('并行处理性能', async () => {
      const templates = []
      for (let i = 0; i < 10; i++) {
        templates.push(`
          <div style="
            background: linear-gradient(45deg, #ff6b6b, #4ecdc4);
            padding: 30px;
            border-radius: 15px;
            color: white;
            text-align: center;
            font-size: 18px;
          ">
            并行模板 ${i + 1}
          </div>
        `)
      }

      const results = await measurePerformance('并行处理(10个)', async () => {
        const promises = templates.map(template => {
          const dom = new JSDOM(template)
          return satori(dom, {
            width: 400,
            height: 300,
            fonts
          })
        })
        
        return Promise.all(promises)
      })

      expect(results).toHaveLength(10)
      results.forEach(svg => {
        expect(svg).toBeDefined()
        expect(svg).toContain('<svg')
      })
    })
  })

  describe('内存使用测试', () => {
    it('大量元素内存使用', async () => {
      let manyElements = ''
      for (let i = 0; i < 50; i++) {
        manyElements += `
          <div style="
            background: #f0f0f0;
            margin: 5px;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          ">
            <h3>元素 ${i + 1}</h3>
            <p>这是第 ${i + 1} 个元素的内容描述</p>
            <div style="display: flex; gap: 10px;">
              <span style="background: #e3f2fd; padding: 5px; border-radius: 4px;">标签1</span>
              <span style="background: #f3e5f5; padding: 5px; border-radius: 4px;">标签2</span>
            </div>
          </div>
        `
      }

      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  ${manyElements}
</body>
</html>
      `)

      const svg = await measurePerformance('大量元素(50个)', () =>
        satori(dom, {
          width: 800,
          height: 600,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('深度嵌套内存使用', async () => {
      let nestedHtml = '<div style="background: #f0f0f0; padding: 20px;">'
      for (let i = 0; i < 30; i++) {
        nestedHtml += `
          <div style="
            margin: 10px;
            padding: 15px;
            background: hsl(${i * 12}, 70%, 80%);
            border-radius: 8px;
            border-left: 4px solid hsl(${i * 12}, 70%, 50%);
          ">
            <h4>层级 ${i + 1}</h4>
            <p>这是第 ${i + 1} 层嵌套的内容</p>
        `
      }
      nestedHtml += '最深层内容'
      for (let i = 0; i < 30; i++) {
        nestedHtml += '</div>'
      }
      nestedHtml += '</div>'

      const dom = new JSDOM(nestedHtml)

      const svg = await measurePerformance('深度嵌套(30层)', () =>
        satori(dom, {
          width: 800,
          height: 600,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('字体性能测试', () => {
    it('多字体加载性能', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    padding: 30px;
    background: white;
    border-radius: 15px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
  ">
    <h1 style="font-family: 'Roboto', sans-serif; color: #333; margin-bottom: 20px;">
      多字体测试
    </h1>
    
    <p style="font-family: '你好', sans-serif; font-size: 18px; color: #666; line-height: 1.6;">
      这是中文字体测试内容，包含各种中文字符：你好世界，欢迎使用 Satori！
    </p>
    
    <div style="
      margin-top: 20px;
      padding: 15px;
      background: #f8f9fa;
      border-radius: 8px;
      font-family: 'Roboto', sans-serif;
    ">
      <h3>英文内容</h3>
      <p>This is English content with Roboto font.</p>
    </div>
  </div>
</body>
</html>
      `)

      const svg = await measurePerformance('多字体加载', () =>
        satori(dom, {
          width: 600,
          height: 400,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('复杂布局性能', () => {
    it('Flexbox 复杂布局性能', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<head>
  <style>
    button, input, select, textarea {
      border: none !important;
      background: none !important;
      box-shadow: none !important;
    }
  </style>
</head>
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
      padding: 20px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    ">
      <h1 style="margin: 0; color: #333; font-size: 24px;">复杂布局测试</h1>
      <div style="display: flex; gap: 15px;">
        <button style="
          display: flex;
          background: #2196f3;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
        ">按钮1</button>
        <button style="
          display: flex;
          background: #4caf50;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
        ">按钮2</button>
      </div>
    </header>
    
    <main style="
      flex: 1;
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
    ">
      <div style="
        flex: 1 1 250px;
        min-width: 250px;
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        display: flex;
        flex-direction: column;
        gap: 15px;
      ">
        <h3 style="margin: 0; color: #333;">卡片 1</h3>
        <p style="margin: 0; color: #666; line-height: 1.5;">
          这是第一个卡片的内容描述，包含一些文本信息。
        </p>
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: auto;
        ">
          <span style="
            background: #e3f2fd;
            color: #1976d2;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
          ">标签</span>
          <span style="color: #666; font-size: 14px;">2024-01-15</span>
        </div>
      </div>
      
      <div style="
        flex: 1 1 250px;
        min-width: 250px;
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        display: flex;
        flex-direction: column;
        gap: 15px;
      ">
        <h3 style="margin: 0; color: #333;">卡片 2</h3>
        <p style="margin: 0; color: #666; line-height: 1.5;">
          这是第二个卡片的内容描述，包含一些文本信息。
        </p>
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: auto;
        ">
          <span style="
            background: #f3e5f5;
            color: #7b1fa2;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
          ">标签</span>
          <span style="color: #666; font-size: 14px;">2024-01-15</span>
        </div>
      </div>
      
      <div style="
        flex: 1 1 250px;
        min-width: 250px;
        background: white;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        display: flex;
        flex-direction: column;
        gap: 15px;
      ">
        <h3 style="margin: 0; color: #333;">卡片 3</h3>
        <p style="margin: 0; color: #666; line-height: 1.5;">
          这是第三个卡片的内容描述，包含一些文本信息。
        </p>
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: auto;
        ">
          <span style="
            background: #e8f5e8;
            color: #388e3c;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 12px;
          ">标签</span>
          <span style="color: #666; font-size: 14px;">2024-01-15</span>
        </div>
      </div>
    </main>
  </div>
</body>
</html>
      `)

      const svg = await measurePerformance('Flexbox 复杂布局', () =>
        satori(dom, {
          width: 1000,
          height: 800,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('极端情况测试', () => {
    it('极小尺寸性能', async () => {
      const dom = new JSDOM('<div>Hello</div>')

      const svg = await measurePerformance('极小尺寸(1x1)', () =>
        satori(dom, {
          width: 1,
          height: 1,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('极大尺寸性能', async () => {
      const dom = new JSDOM('<div>Hello</div>')

      const svg = await measurePerformance('极大尺寸(2000x2000)', () =>
        satori(dom, {
          width: 2000,
          height: 2000,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('极长文本性能', async () => {
      const longText = 'A'.repeat(5000)
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px; word-wrap: break-word;">
    ${longText}
  </div>
</body>
</html>
      `)

      const svg = await measurePerformance('极长文本(5000字符)', () =>
        satori(dom, {
          width: 600,
          height: 400,
          fonts
        })
      )

      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })
}) 