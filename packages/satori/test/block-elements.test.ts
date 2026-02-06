import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('块级元素布局', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该支持 div 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 100px; height: 100px; background: red; margin: 10px;"></div>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 140, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 p 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <p style="width: 100px; height: 50px; background: blue; margin: 10px;">段落文本</p>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 100, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 h1-h6 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <h1 style="width: 100px; height: 40px; background: green; margin: 5px; font-size: 16px;">标题1</h1>
      <h2 style="width: 100px; height: 35px; background: orange; margin: 5px; font-size: 14px;">标题2</h2>
      <h3 style="width: 100px; height: 30px; background: purple; margin: 5px; font-size: 12px;">标题3</h3>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 150, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 section 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <section style="width: 100px; height: 80px; background: #00ffff; margin: 10px; display: block;">
        <div style="width: 80px; height: 30px; background: #ffff00; margin: 5px;">内容</div>
      </section>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 120, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 article 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <article style="width: 100px; height: 80px; background: #ff00ff; margin: 10px; display: block;">
        <div style="width: 80px; height: 30px; background: #00ff00; margin: 5px;">文章内容</div>
      </article>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 120, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 header 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <header style="width: 100px; height: 60px; background: brown; margin: 10px; display: block;">
        <div style="width: 80px; height: 20px; background: pink; margin: 5px;">头部</div>
      </header>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 100, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 footer 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <footer style="width: 100px; height: 60px; background: gray; margin: 10px; display: block;">
        <div style="width: 80px; height: 20px; background: lightblue; margin: 5px;">底部</div>
      </footer>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 100, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 nav 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <nav style="width: 100px; height: 50px; background: darkgreen; margin: 10px; display: block;">
        <div style="width: 80px; height: 15px; background: lightgreen; margin: 5px;">导航</div>
      </nav>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 90, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 main 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <main style="width: 100px; height: 80px; background: darkblue; margin: 10px; display: block;">
        <div style="width: 80px; height: 30px; background: lightblue; margin: 5px;">主要内容</div>
      </main>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 120, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 aside 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <aside style="width: 100px; height: 70px; background: darkred; margin: 10px; display: block;">
        <div style="width: 80px; height: 25px; background: lightcoral; margin: 5px;">侧边栏</div>
      </aside>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 110, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 form 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <form style="width: 100px; height: 80px; background: darkorange; margin: 10px; display: block;">
        <div style="width: 80px; height: 30px; background: orange; margin: 5px;">表单</div>
      </form>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 120, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 ul 和 li 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <ul style="width: 100px; height: 80px; background: #800080; margin: 10px; display: block; list-style: none; padding: 0;">
        <li style="width: 80px; height: 20px; background: #dda0dd; margin: 5px; display: block;">列表项1</li>
        <li style="width: 80px; height: 20px; background: #ee82ee; margin: 5px; display: block;">列表项2</li>
      </ul>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 120, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 blockquote 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <blockquote style="width: 100px; height: 60px; background: darkcyan; margin: 10px; display: block;">
        <div style="width: 80px; height: 20px; background: aqua; margin: 5px;">引用</div>
      </blockquote>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 100, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 figure 和 figcaption 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <figure style="width: 100px; height: 80px; background: darkmagenta; margin: 10px; display: block;">
        <div style="width: 80px; height: 40px; background: fuchsia; margin: 5px;">图片</div>
        <figcaption style="width: 80px; height: 20px; background: pink; margin: 5px; display: block;">说明</figcaption>
      </figure>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 120, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 address 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <address style="width: 100px; height: 50px; background: darkgray; margin: 10px; display: block;">
        <div style="width: 80px; height: 15px; background: lightgray; margin: 5px;">地址</div>
      </address>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 90, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持 pre 元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <pre style="width: 100px; height: 60px; background: black; color: white; margin: 10px; display: block; font-size: 12px;">
代码块
      </pre>
    </body></html>`)
    const svg = await satori(dom, { width: 140, height: 100, fonts })
    expect(toImage(svg, 280)).toMatchImageSnapshot()
  })

  it('应该支持嵌套块级元素布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <section style="width: 120px; height: 100px; background: lightblue; margin: 10px; display: block;">
        <header style="width: 100px; height: 30px; background: lightgreen; margin: 5px; display: block;">
          <h1 style="width: 80px; height: 20px; background: lightyellow; margin: 5px; font-size: 14px; display: block;">标题</h1>
        </header>
        <main style="width: 100px; height: 40px; background: lightpink; margin: 5px; display: block;">
          <p style="width: 80px; height: 15px; background: lightcoral; margin: 5px; display: block;">内容</p>
        </main>
        <footer style="width: 100px; height: 20px; background: lightgray; margin: 5px; display: block;">
          <div style="width: 80px; height: 10px; background: white; margin: 5px;">底部</div>
        </footer>
      </section>
    </body></html>`)
    const svg = await satori(dom, { width: 160, height: 140, fonts })
    expect(toImage(svg, 320)).toMatchImageSnapshot()
  })
}) 