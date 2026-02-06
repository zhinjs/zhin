import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('边界条件测试', () => {
  let fonts
  initFonts((f) => (fonts = f))

  describe('尺寸边界', () => {
    it('应该处理最小有效尺寸', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      const svg = await satori(dom, {
        width: 1,
        height: 1,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      expect(svg).toContain('width="1"')
      expect(svg).toContain('height="1"')
    })

    it('应该处理最大合理尺寸', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      const svg = await satori(dom, {
        width: 3000,
        height: 3000,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      expect(svg).toContain('width="3000"')
      expect(svg).toContain('height="3000"')
    })

    it('应该处理正方形尺寸', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      const svg = await satori(dom, {
        width: 500,
        height: 500,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
      expect(svg).toContain('width="500"')
      expect(svg).toContain('height="500"')
    })

    it('应该处理宽高比极端的尺寸', async () => {
      const dom = new JSDOM('<div>Hello</div>')
      
      // 极宽的尺寸
      const wideSvg = await satori(dom, {
        width: 2000,
        height: 100,
        fonts
      })
      
      expect(wideSvg).toBeDefined()
      expect(wideSvg).toContain('width="2000"')
      expect(wideSvg).toContain('height="100"')
      
      // 极高的尺寸
      const tallSvg = await satori(dom, {
        width: 100,
        height: 2000,
        fonts
      })
      
      expect(tallSvg).toBeDefined()
      expect(tallSvg).toContain('width="100"')
      expect(tallSvg).toContain('height="2000"')
    })
  })

  describe('内容边界', () => {
    it('应该处理空内容', async () => {
      const dom = new JSDOM('<div></div>')
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理只有空格的内容', async () => {
      const dom = new JSDOM('<div>   </div>')
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理换行符内容', async () => {
      const dom = new JSDOM('<div>\n\n\n</div>')
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理单字符内容', async () => {
      const dom = new JSDOM('<div>A</div>')
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理极长文本', async () => {
      const longText = 'A'.repeat(10000)
      const dom = new JSDOM(`<div>${longText}</div>`)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理包含特殊字符的文本', async () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`'
      const dom = new JSDOM(`<div>${specialChars}</div>`)
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })
  })

  describe('样式边界', () => {
    it('应该处理零值样式', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 0px;
    height: 0px;
    margin: 0px;
    padding: 0px;
    font-size: 0px;
    line-height: 0;
  ">
    Content
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

    it('应该处理负值样式', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    margin: -10px;
    padding: -5px;
    font-size: -2px;
  ">
    Content
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

    it('应该处理极大值样式', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 9999px;
    height: 9999px;
    margin: 9999px;
    padding: 9999px;
    font-size: 9999px;
  ">
    Content
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

    it('应该处理百分比样式', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 100%;
    height: 100%;
    margin: 10%;
    padding: 5%;
    font-size: 200%;
  ">
    Content
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

    it('应该处理视口单位样式', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    width: 50vw;
    height: 50vh;
    margin: 5vw;
    padding: 2vh;
    font-size: 3vw;
  ">
    Content
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

  describe('嵌套边界', () => {
    it('应该处理单层嵌套', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div>
    <span>Content</span>
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

    it('应该处理深层嵌套', async () => {
      let nestedHtml = '<div>'
      for (let i = 0; i < 100; i++) {
        nestedHtml += '<div>'
      }
      nestedHtml += 'Deep Content'
      for (let i = 0; i < 100; i++) {
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

    it('应该处理未闭合的标签', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div>
    <span>Content
    <p>Another content
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

    it('应该处理自闭合标签', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div>
    <br />
    <hr />
    <img src="https://example.com/test.jpg" width="100" height="100" />
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

  describe('元素数量边界', () => {
    it('应该处理单个元素', async () => {
      const dom = new JSDOM('<div>Single Element</div>')
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理少量元素', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div>Element 1</div>
  <div>Element 2</div>
  <div>Element 3</div>
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

    it('应该处理大量元素', async () => {
      let manyElements = ''
      for (let i = 0; i < 200; i++) {
        manyElements += `<div>Element ${i + 1}</div>`
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

  describe('字体边界', () => {
    it('应该处理单个字体', async () => {
      const dom = new JSDOM('<div>Single Font</div>')
      
      const svg = await satori(dom, {
        width: 600,
        height: 400,
        fonts: [fonts[0]] // 只使用第一个字体
      })
      
      expect(svg).toBeDefined()
      expect(svg).toContain('<svg')
    })

    it('应该处理多个字体', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="font-family: 'Roboto', sans-serif;">Roboto Font</div>
  <div style="font-family: '你好', sans-serif;">中文字体</div>
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

    it('应该处理字体回退', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="font-family: 'NonExistentFont', 'Roboto', sans-serif;">
    Fallback Font Test
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

  describe('颜色边界', () => {
    it('应该处理透明色', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    background-color: transparent;
    color: transparent;
    border: 1px solid transparent;
  ">
    Transparent Content
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

    it('应该处理 RGBA 颜色', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    background-color: rgba(255, 0, 0, 0.5);
    color: rgba(0, 255, 0, 0.8);
    border: 2px solid rgba(0, 0, 255, 0.3);
  ">
    RGBA Colors
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

    it('应该处理 HSL 颜色', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    background-color: hsl(120, 100%, 50%);
    color: hsl(240, 100%, 50%);
    border: 2px solid hsl(0, 100%, 50%);
  ">
    HSL Colors
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

    it('应该处理 HSLA 颜色', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    background-color: hsla(120, 100%, 50%, 0.5);
    color: hsla(240, 100%, 50%, 0.8);
    border: 2px solid hsla(0, 100%, 50%, 0.3);
  ">
    HSLA Colors
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

  describe('变换边界', () => {
    it('应该处理零度旋转', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="transform: rotate(0deg);">
    Zero Rotation
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

    it('应该处理大角度旋转', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="transform: rotate(720deg);">
    Large Rotation
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

    it('应该处理零缩放', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="transform: scale(0);">
    Zero Scale
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

    it('应该处理大缩放', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="transform: scale(10);">
    Large Scale
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

    it('应该处理组合变换', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    transform: 
      rotate(45deg) 
      scale(2) 
      translateX(100px) 
      translateY(50px) 
      skewX(10deg) 
      skewY(5deg);
  ">
    Complex Transform
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

  describe('定位边界', () => {
    it('应该处理绝对定位', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    position: absolute;
    top: 0;
    left: 0;
    width: 100px;
    height: 100px;
    background: red;
  ">
    Absolute Positioned
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

    it('应该处理负定位', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    position: absolute;
    top: -50px;
    left: -50px;
    width: 100px;
    height: 100px;
    background: blue;
  ">
    Negative Positioned
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

    it('应该处理百分比定位', async () => {
      const dom = new JSDOM(`
<!DOCTYPE html>
<html>
<body>
  <div style="
    position: absolute;
    top: 50%;
    left: 50%;
    width: 100px;
    height: 100px;
    background: green;
  ">
    Percentage Positioned
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
}) 