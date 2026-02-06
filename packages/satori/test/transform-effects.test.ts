import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('变换和效果', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该支持基本变换', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: translate(20px, 20px); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 100, height: 100, fonts })
    expect(toImage(svg, 200)).toMatchImageSnapshot()
  })

  it('应该支持旋转变换', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: rotate(45deg); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持缩放变换', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: scale(1.5); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 100, height: 100, fonts })
    expect(toImage(svg, 200)).toMatchImageSnapshot()
  })

  it('应该支持倾斜变换', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: skew(20deg); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持组合变换', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: translate(20px, 20px) rotate(45deg) scale(1.2); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持变换原点', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform-origin: center; transform: rotate(45deg); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持盒阴影', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: white; box-shadow: 5px 5px 10px rgba(0,0,0,0.5); margin: 20px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持内阴影', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: white; box-shadow: inset 5px 5px 10px rgba(0,0,0,0.5); margin: 20px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持多重阴影', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: white; box-shadow: 5px 5px 10px rgba(0,0,0,0.5), inset 2px 2px 5px rgba(255,0,0,0.3); margin: 20px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持透明度', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: red; opacity: 0.5; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持背景透明度', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: rgba(255,0,0,0.5); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持边框透明度', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; border: 5px solid rgba(0,0,255,0.5); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持混合模式', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; margin: 10px;">
        <div style="width: 50px; height: 50px; background: blue; mix-blend-mode: multiply;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持滤镜效果', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: red; filter: blur(2px); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持灰度滤镜', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: red; filter: grayscale(50%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持亮度滤镜', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: red; filter: brightness(150%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持对比度滤镜', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: red; filter: contrast(200%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持组合滤镜', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80px; height: 80px; background: red; filter: blur(1px) brightness(150%) contrast(200%); margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 120, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持变换和阴影组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: rotate(45deg); box-shadow: 5px 5px 10px rgba(0,0,0,0.5); margin: 20px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持变换和透明度组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: red; transform: scale(1.5); opacity: 0.7; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 100, height: 100, fonts })
    expect(toImage(svg, 200)).toMatchImageSnapshot()
  })
}) 