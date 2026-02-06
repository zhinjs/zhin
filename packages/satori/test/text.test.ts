import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('文本和字体', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该渲染基本文本', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="padding: 10px; background: #eee;">Hello World</div>
    </body></html>`)
    const svg = await satori(dom, { width: 150, height: 60, fonts })
    expect(toImage(svg, 300)).toMatchImageSnapshot()
  })

  it('应该支持文本对齐', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; background: #eee;">
        <div style="text-align: left; padding: 5px;">左对齐文本</div>
        <div style="text-align: center; padding: 5px;">居中对齐文本</div>
        <div style="text-align: right; padding: 5px;">右对齐文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 240, height: 120, fonts })
    expect(toImage(svg, 360)).toMatchImageSnapshot()
  })

  it('应该支持字体大小', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="font-size: 12px;">小字体文本</div>
        <div style="font-size: 16px;">正常字体文本</div>
        <div style="font-size: 24px;">大字体文本</div>
        <div style="font-size: 32px;">超大字体文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 200, fonts })
    expect(toImage(svg, 400)).toMatchImageSnapshot()
  })

  it('应该支持字体粗细', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="font-weight: normal;">正常粗细</div>
        <div style="font-weight: bold;">粗体文本</div>
        <div style="font-weight: 100;">极细字体</div>
        <div style="font-weight: 900;">极粗字体</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持字体样式', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="font-style: normal;">正常样式</div>
        <div style="font-style: italic;">斜体文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 80, fonts })
    expect(toImage(svg, 160)).toMatchImageSnapshot()
  })

  it('应该支持文本装饰', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="text-decoration: underline;">下划线文本</div>
        <div style="text-decoration: line-through;">删除线文本</div>
        <div style="text-decoration: underline line-through;">下划线和删除线</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持文本变换', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="text-transform: none;">正常文本</div>
        <div style="text-transform: uppercase;">大写文本</div>
        <div style="text-transform: lowercase;">小写文本</div>
        <div style="text-transform: capitalize;">首字母大写文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持行高', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="line-height: 1;">紧凑行高</div>
        <div style="line-height: 1.5;">正常行高</div>
        <div style="line-height: 2;">宽松行高</div>
        <div style="line-height: 3;">很宽松行高</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 180, fonts })
    expect(toImage(svg, 360)).toMatchImageSnapshot()
  })

  it('应该支持字母间距', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="letter-spacing: normal;">正常间距</div>
        <div style="letter-spacing: 2px;">宽间距</div>
        <div style="letter-spacing: -1px;">窄间距</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 100, fonts })
    expect(toImage(svg, 200)).toMatchImageSnapshot()
  })

  it('应该支持空白字符处理', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="white-space: normal;">正常空白处理</div>
        <div style="white-space: pre;">保留空白和换行</div>
        <div style="white-space: nowrap;">不换行文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 120, fonts })
    expect(toImage(svg, 240)).toMatchImageSnapshot()
  })

  it('应该支持单词换行', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px; width: 150px;">
        <div style="word-break: normal;">正常换行 verylongword</div>
        <div style="word-break: break-all;">强制换行 verylongword</div>
        <div style="word-break: break-word;">智能换行 verylongword</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 150, fonts })
    expect(toImage(svg, 300)).toMatchImageSnapshot()
  })

  it('应该支持文本溢出', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="width: 100px; text-overflow: clip; overflow: hidden;">很长的文本会被裁剪</div>
        <div style="width: 100px; text-overflow: ellipsis; overflow: hidden;">很长的文本会显示省略号</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 150, height: 80, fonts })
    expect(toImage(svg, 120)).toMatchImageSnapshot()
  })

  it('应该支持文本阴影', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="background: #eee; padding: 10px;">
        <div style="text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">带阴影的文本</div>
        <div style="text-shadow: 1px 1px 2px red;">彩色阴影文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 200, height: 80, fonts })
    expect(toImage(svg, 160)).toMatchImageSnapshot()
  })
}) 