import { it, describe, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { initFonts, toImage } from './utils.js'
import satori from '../src/index.js'

describe('复杂场景', () => {
  let fonts
  initFonts((f) => (fonts = f))

  it('应该支持复杂的卡片布局', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 300px; height: 200px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 20px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
        <div style="color: white; font-size: 24px; font-weight: bold; margin-bottom: 10px;">标题文本</div>
        <div style="color: rgba(255,255,255,0.8); font-size: 16px; line-height: 1.5;">这是一段描述文本，用于测试复杂的布局和样式组合。</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 360, height: 260, fonts })
    expect(toImage(svg, 720)).toMatchImageSnapshot()
  })

  it('应该支持响应式设计元素', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80vw; height: 60vh; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border-radius: 20px; display: flex; align-items: center; justify-content: center;">
        <div style="text-align: center; color: white;">
          <div style="font-size: 5vw; font-weight: bold; margin-bottom: 2vh;">响应式标题</div>
          <div style="font-size: 2vw; opacity: 0.9;">响应式内容</div>
        </div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 1000, height: 800, fonts })
    expect(toImage(svg, 500)).toMatchImageSnapshot()
  })

  it('应该支持复杂的变换组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: #f0f0f0; position: relative;">
        <div style="width: 50px; height: 50px; background: red; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(45deg) scale(1.5); box-shadow: 0 5px 15px rgba(0,0,0,0.3);"></div>
        <div style="width: 50px; height: 50px; background: blue; position: absolute; top: 25%; left: 25%; transform: translate(-50%, -50%) rotate(-30deg) scale(0.8); opacity: 0.7;"></div>
        <div style="width: 50px; height: 50px; background: green; position: absolute; top: 75%; left: 75%; transform: translate(-50%, -50%) rotate(90deg) scale(1.2); border-radius: 50%;"></div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 240, height: 240, fonts })
    expect(toImage(svg, 480)).toMatchImageSnapshot()
  })

  it('应该支持复杂的文本效果', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 400px; height: 150px; background: linear-gradient(135deg, #667eea, #764ba2); padding: 20px; border-radius: 15px;">
        <div style="color: white; font-size: 32px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.5); text-align: center; margin-bottom: 10px;">特效文本</div>
        <div style="color: rgba(255,255,255,0.9); font-size: 18px; text-align: center; letter-spacing: 2px; text-transform: uppercase;">带阴影和间距的文本</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 460, height: 210, fonts })
    expect(toImage(svg, 920)).toMatchImageSnapshot()
  })

  it('应该支持复杂的边框和背景组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border: 10px solid rgba(255,255,255,0.3); border-radius: 50%; box-shadow: inset 0 0 20px rgba(0,0,0,0.2), 0 10px 30px rgba(0,0,0,0.3); position: relative;">
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 24px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">圆形</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 240, height: 240, fonts })
    expect(toImage(svg, 480)).toMatchImageSnapshot()
  })

  it('应该支持复杂的裁剪和遮罩组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: linear-gradient(135deg, #667eea, #764ba2); clip-path: polygon(50% 0%, 0% 100%, 100% 100%); mask-image: linear-gradient(to bottom, transparent, black); position: relative;">
        <div style="position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); color: white; font-size: 18px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">三角形</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 240, height: 240, fonts })
    expect(toImage(svg, 480)).toMatchImageSnapshot()
  })

  it('应该支持复杂的布局嵌套', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 300px; height: 250px; background: #f8f9fa; border-radius: 15px; padding: 20px; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
          <div style="width: 50px; height: 50px; background: linear-gradient(45deg, #ff6b6b, #4ecdc4); border-radius: 50%; margin-right: 15px;"></div>
          <div>
            <div style="font-size: 18px; font-weight: bold; color: #333; margin-bottom: 5px;">用户名称</div>
            <div style="font-size: 14px; color: #666;">用户描述信息</div>
          </div>
        </div>
        <div style="background: white; border-radius: 10px; padding: 15px; border-left: 4px solid #4ecdc4;">
          <div style="font-size: 16px; color: #333; margin-bottom: 10px;">内容标题</div>
          <div style="font-size: 14px; color: #666; line-height: 1.5;">这是一段详细的内容描述，用于测试复杂的嵌套布局和样式组合效果。</div>
        </div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 360, height: 310, fonts })
    expect(toImage(svg, 720)).toMatchImageSnapshot()
  })

  it('应该支持复杂的动画效果模拟', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 200px; height: 200px; background: radial-gradient(circle, #667eea, #764ba2); border-radius: 20px; position: relative; overflow: hidden;">
        <div style="position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: linear-gradient(45deg, transparent 30%, rgba(255,255,255,0.3) 50%, transparent 70%); transform: rotate(45deg);"></div>
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 20px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">动态效果</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 240, height: 240, fonts })
    expect(toImage(svg, 480)).toMatchImageSnapshot()
  })

  it('应该支持复杂的颜色和透明度组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 250px; height: 200px; background: linear-gradient(135deg, rgba(255,107,107,0.8), rgba(78,205,196,0.8)); border-radius: 15px; position: relative;">
        <div style="position: absolute; top: 10px; left: 10px; width: 50px; height: 50px; background: rgba(255,255,255,0.3); border-radius: 10px; backdrop-filter: blur(5px);"></div>
        <div style="position: absolute; top: 70px; left: 70px; width: 50px; height: 50px; background: rgba(0,0,0,0.2); border-radius: 10px; backdrop-filter: blur(5px);"></div>
        <div style="position: absolute; bottom: 20px; right: 20px; color: white; font-size: 18px; font-weight: bold; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">玻璃效果</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 290, height: 240, fonts })
    expect(toImage(svg, 580)).toMatchImageSnapshot()
  })



  it('应该支持复杂的响应式单位组合', async () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body>
      <div style="width: 80vw; height: 60vh; background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 5vmin; padding: 3vw; display: flex; flex-direction: column; justify-content: center; align-items: center;">
        <div style="font-size: 5vmin; color: white; font-weight: bold; margin-bottom: 2vh; text-shadow: 1px 1px 2px rgba(0,0,0,0.5);">响应式设计</div>
        <div style="font-size: 2.5vmin; color: rgba(255,255,255,0.9); text-align: center; line-height: 1.5; max-width: 60vw;">使用 vw、vh、vmin、vmax 等视口单位创建的响应式布局</div>
      </div>
    </body></html>`)
    const svg = await satori(dom, { width: 1200, height: 900, fonts })
    expect(toImage(svg, 600)).toMatchImageSnapshot()
  })
}) 