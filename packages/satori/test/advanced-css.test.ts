import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('高级 CSS 功能', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该支持裁剪路径', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: circle(50%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持多边形裁剪路径', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: polygon(50% 0%, 0% 100%, 100% 100%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持矩形裁剪路径', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: inset(20px); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持椭圆裁剪路径', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: ellipse(40% 50% at 50% 50%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持遮罩图片', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; mask-image: linear-gradient(to right, transparent, black); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持遮罩位置', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; mask-image: linear-gradient(45deg, transparent 50%, black 50%); mask-position: center; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持遮罩尺寸', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; mask-image: linear-gradient(45deg, transparent, black); mask-size: 50px 50px; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持遮罩重复', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; mask-image: linear-gradient(45deg, transparent 50%, black 50%); mask-size: 20px 20px; mask-repeat: repeat; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持溢出隐藏', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: #eee; overflow: hidden; margin: 10px;">
        <div style="width: 150px; height: 150px; background: red;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })



  it('应该支持内容遮罩', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; -webkit-mask-image: linear-gradient(to right, transparent, black); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持背景裁剪', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red, blue); border-radius: 20px; background-clip: padding-box; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持内容裁剪', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red, blue); border-radius: 20px; background-clip: content-box; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持文本裁剪', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red, blue); border-radius: 20px; background-clip: text; color: transparent; margin: 10px;">文本</div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持裁剪路径和遮罩组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: circle(50%); mask-image: linear-gradient(to right, transparent, black); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持裁剪路径和溢出组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: #eee; clip-path: circle(50%); overflow: hidden; margin: 10px;">
        <div style="width: 150px; height: 150px; background: red;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持复杂裁剪路径', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: polygon(0% 0%, 100% 0%, 50% 100%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持多个裁剪路径', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; clip-path: circle(50%) polygon(0% 0%, 100% 0%, 50% 100%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })
}) 