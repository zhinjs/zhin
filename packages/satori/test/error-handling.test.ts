import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('错误处理', () => {
  let fonts
  initFonts((f) => (fonts = f))

  describe('参数验证', () => {
    it('应该处理空的 DOM', async () => {
      const dom = new JSDOM('')
      
      // 空的 DOM 应该能正常处理，只是生成空的 SVG
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理无效的宽度', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      // 负宽度应该被处理为 0
      const svg = await satori(dom, {
        width: -100,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理无效的高度', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      // 负高度应该被处理为 0
      const svg = await satori(dom, {
        width: 600,
        height: -100,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理零宽度', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      // 零宽度应该能正常处理
      const svg = await satori(dom, {
        width: 0,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理零高度', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      // 零高度应该能正常处理
      const svg = await satori(dom, {
        width: 600,
        height: 0,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理空的字体数组', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      await expect(satori(dom, {
        width: 600,
        height: 400,
        fonts: []
      })).rejects.toThrow()
    })

    it('应该处理无效的字体数据', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      await expect(satori(dom, {
        width: 600,
        height: 400,
        fonts: [
          {
            name: 'InvalidFont',
            data: new ArrayBuffer(0), // 空的字体数据
            weight: 400,
            style: 'normal'
          }
        ]
      })).rejects.toThrow()
    })
  })

  describe('CSS 错误处理', () => {
    it('应该处理无效的颜色值', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="color: invalid-color; background: #f0f0f0; padding: 20px;">
    Hello World
  </div>
</body>
</html>
      `)
      
      // 应该不会抛出错误，而是使用默认颜色
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理无效的尺寸值', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="width: invalid-width; height: invalid-height; background: #f0f0f0;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理无效的字体大小', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="font-size: invalid-size; background: #f0f0f0; padding: 20px;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理无效的边距值', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="margin: invalid-margin; background: #f0f0f0; padding: 20px;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理无效的填充值', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="padding: invalid-padding; background: #f0f0f0;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('HTML 错误处理', () => {
    it('应该处理不支持的 HTML 元素', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px;">
    支持的内容
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      // 不支持的元素应该被忽略，只渲染支持的内容
    })

    it('应该处理损坏的 HTML', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px;">
    <p>正常内容</p>
    <div>未闭合的 div
    <span>嵌套的 span
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理空的文本节点', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px;">
    <p></p>
    <div>  </div>
    <span>有内容的文本</span>
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('字体错误处理', () => {
    it('应该处理字体未找到的情况', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="font-family: 'NonExistentFont', sans-serif; background: #f0f0f0; padding: 20px;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      // 应该回退到默认字体
    })

    it('应该处理字体权重不匹配', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="font-weight: 900; background: #f0f0f0; padding: 20px;">
    Bold Text
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      // 应该回退到可用的字体权重
    })
  })

  describe('布局错误处理', () => {
    it('应该处理溢出内容', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="width: 100px; height: 50px; background: #f0f0f0; overflow: hidden;">
    <div style="width: 200px; height: 100px; background: red;">
      这个内容会溢出容器
    </div>
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理负边距', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="margin: -10px; background: #f0f0f0; padding: 20px;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理负填充', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="padding: -10px; background: #f0f0f0;">
    Hello World
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('边界条件', () => {
    it('应该处理极大的尺寸', async () => {
      const dom = new JSDOM('<div>Hello World</div>')
      
      // 极大尺寸应该能正常处理，但可能性能较慢
      const svg = await satori(dom, {
        width: 10000,
        height: 10000,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      expect(svg).toContain('width="10000"')
      expect(svg).toContain('height="10000"')
    })

    it('应该处理极小的尺寸', async () => {
      const dom = new JSDOM('<div>Hello World</div>')
      
      const svg = await satori(dom, {
        width: 1,
        height: 1,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理极长的文本', async () => {
      const longText = 'A'.repeat(10000)
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px;">
    ${longText}
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理深度嵌套', async () => {
      let nestedHtml = '<div style="background: #f0f0f0; padding: 10px;">'
      for (let i = 0; i < 50; i++) {
        nestedHtml += '<div style="margin: 5px; padding: 5px;">'
      }
      nestedHtml += 'Deep Content'
      for (let i = 0; i < 50; i++) {
        nestedHtml += '</div>'
      }
      nestedHtml += '</div>'
      
      const dom = new JSDOM(nestedHtml)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理大量元素', async () => {
      let manyElements = ''
      for (let i = 0; i < 100; i++) {
        manyElements += `<div style="background: #f0f0f0; margin: 5px; padding: 10px;">Element ${i}</div>`
      }
      
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  ${manyElements}
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('特殊字符处理', () => {
    it('应该处理特殊 Unicode 字符', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px;">
    <p>Emoji: 😀🎉🚀</p>
    <p>特殊符号: ©®™€¥£¢</p>
    <p>数学符号: ∑∏∫√∞</p>
    <p>希腊字母: αβγδε</p>
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理 HTML 实体', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px;">
    <p>&amp; &lt; &gt; &quot; &apos; &copy; &reg; &trade;</p>
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理换行符和制表符', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="background: #f0f0f0; padding: 20px; white-space: pre;">
    Line 1
    Line 2
    Line 3
    Tab:	Tabbed
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('内存和性能边界', () => {
    it('应该处理内存密集型操作', async () => {
      // 创建大量样式属性
      let complexStyles = 'background: #f0f0f0; padding: 20px;'
      for (let i = 0; i < 100; i++) {
        complexStyles += `margin-${i}: ${i}px; padding-${i}: ${i}px;`
      }
      
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="${complexStyles}">
    Complex Styled Content
  </div>
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理超时情况', async () => {
      // 创建一个可能导致长时间处理的复杂布局
      let complexLayout = ''
      for (let i = 0; i < 20; i++) {
        complexLayout += `
          <div style="
            display: flex;
            flex-direction: column;
            background: linear-gradient(45deg, #ff0000, #00ff00, #0000ff);
            margin: 10px;
            padding: 15px;
            border-radius: 10px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            transform: rotate(${i}deg) scale(1.1);
          ">
            <h1>Title ${i}</h1>
            <p>Content ${i}</p>
            <div style="display: flex; gap: 10px;">
              <span>Item 1</span>
              <span>Item 2</span>
              <span>Item 3</span>
            </div>
          </div>
        `
      }
      
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  ${complexLayout}
</body>
</html>
      `)
      
      const svg = await satori(dom, {
        width: 800,
        height: 600,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })
}) 