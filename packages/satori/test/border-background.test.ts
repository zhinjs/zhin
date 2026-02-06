import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('边框和背景', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该支持背景色', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background-color: red; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持基本边框', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; border: 2px solid black; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持边框圆角', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; border-radius: 20px; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })



  it('应该支持边框颜色', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 50px; border: 3px solid red; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border: 3px solid blue; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border: 3px solid green; margin: 5px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 130, height: 180, fonts })
    expect(toImage(svg, 234)).toMatchImageSnapshot()
  })

  it('应该支持边框宽度', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 50px; border: 1px solid black; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border: 5px solid black; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border: 10px solid black; margin: 5px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 130, height: 180, fonts })
    expect(toImage(svg, 234)).toMatchImageSnapshot()
  })

  it('应该支持部分边框', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 50px; border-top: 3px solid red; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border-right: 3px solid blue; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border-bottom: 3px solid green; margin: 5px;"></div>
      <div style="width: 100px; height: 50px; border-left: 3px solid orange; margin: 5px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 130, height: 240, fonts })
    expect(toImage(svg, 312)).toMatchImageSnapshot()
  })

  it('应该支持复杂边框圆角', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; border-radius: 20px 10px 30px 5px; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持百分比边框圆角', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; border-radius: 50%; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持线性渐变背景', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(to right, red, blue); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持径向渐变背景', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: radial-gradient(circle, red, blue); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持背景位置', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red 50%, blue 50%); background-position: center; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持背景尺寸', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red, blue); background-size: 50px 50px; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持背景重复', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red 50%, blue 50%); background-size: 20px 20px; background-repeat: repeat; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持背景裁剪', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red, blue); border-radius: 20px; background-clip: border-box; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持边框和背景组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: linear-gradient(45deg, red, blue); border: 5px solid black; border-radius: 20px; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持多层边框', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: white; border: 10px solid red; border-radius: 20px; margin: 10px;">
        <div style="width: 80px; height: 80px; background: blue; border: 5px solid yellow; border-radius: 10px;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })
}) 