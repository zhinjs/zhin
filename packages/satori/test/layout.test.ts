import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('布局', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该渲染空的 div', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50px; height: 50px; background: #eee;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 80, height: 80, fonts })
    expect(toImage(svg, 160)).toMatchImageSnapshot()
  })

  it('应该支持 flex 布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="display: flex; width: 200px; height: 100px; background: #f0f0f0;">
        <div style="width: 50px; height: 50px; background: red; margin: 10px;"></div>
        <div style="width: 50px; height: 50px; background: blue; margin: 10px;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 240, height: 140, fonts })
    expect(toImage(svg, 360)).toMatchImageSnapshot()
  })

  it('应该支持 column 布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="display: flex; flex-direction: column; width: 100px; height: 200px; background: #f0f0f0;">
        <div style="width: 50px; height: 50px; background: red; margin: 10px;"></div>
        <div style="width: 50px; height: 50px; background: blue; margin: 10px;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 240, fonts })
    expect(toImage(svg, 168)).toMatchImageSnapshot()
  })

  it('应该支持绝对定位', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="position: relative; width: 200px; height: 200px; background: #f0f0f0;">
        <div style="position: absolute; top: 50px; left: 50px; width: 50px; height: 50px; background: red;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 250, height: 250, fonts })
    expect(toImage(svg, 450)).toMatchImageSnapshot()
  })

  it('应该支持百分比尺寸', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: red;">
        <div style="width: 50%; height: 50%; background: blue;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 250, height: 250, fonts })
    expect(toImage(svg, 625)).toMatchImageSnapshot()
  })

  it('应该支持视口单位', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50vw; height: 50vh; background: red;">
        <div style="width: 50%; height: 50%; background: blue;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 1000, height: 1000, fonts })
    expect(toImage(svg, 500)).toMatchImageSnapshot()
  })

  it('应该支持 vmin 和 vmax 单位', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 50vmin; height: 50vmax; background: red;">
        <div style="width: 50%; height: 50%; background: blue;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 800, height: 1000, fonts })
    expect(toImage(svg, 640)).toMatchImageSnapshot()
  })

  it('应该支持混合视口单位', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80vw; height: 60vh; background: red;">
        <div style="width: 50vmin; height: 50vmax; position: absolute; top: 10vh; left: 10vw; background: blue;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 1000, height: 1000, fonts })
    expect(toImage(svg, 600)).toMatchImageSnapshot()
  })

  it('应该支持百分比边距和填充', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: red;">
        <div style="width: 50%; height: 50%; margin: 10%; padding: 5%; background: blue;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 250, height: 250, fonts })
    expect(toImage(svg, 750)).toMatchImageSnapshot()
  })

  it('应该支持嵌套百分比尺寸', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: red;">
        <div style="width: 50%; height: 50%; background: blue;">
          <div style="width: 50%; height: 50%; background: green;"></div>
        </div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 250, height: 250, fonts })
    expect(toImage(svg, 550)).toMatchImageSnapshot()
  })

  it('应该支持百分比绝对定位', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; position: relative; background: red;">
        <div style="width: 50%; height: 50%; position: absolute; top: 25%; left: 25%; background: blue;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 250, height: 250, fonts })
    expect(toImage(svg, 400)).toMatchImageSnapshot()
  })
}) 