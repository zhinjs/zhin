/**
 * HTML 渲染测试插件
 */
import { usePlugin, ZhinTool } from 'zhin.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const plugin = usePlugin();
const { logger } = plugin;

// 输出目录
const OUTPUT_DIR = join(process.cwd(), 'data', 'render-output');

// 确保输出目录存在
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 定义渲染服务类型（避免直接导入）
interface RenderResult {
  data: Buffer | string;
  format: 'svg' | 'png';
  width: number;
  height: number;
  mimeType: string;
}

interface RenderOptions {
  width?: number;
  height?: number;
  format?: 'svg' | 'png';
  backgroundColor?: string;
}

interface HtmlRendererService {
  render(html: string, options?: RenderOptions): Promise<RenderResult>;
}

// 获取 html-renderer 服务
function getRenderer(): HtmlRendererService | undefined {
  return plugin.root.inject('html-renderer' as any) as HtmlRendererService | undefined;
}

// 创建测试渲染工具
const testRenderTool = new ZhinTool('test.render')
  .desc('测试 HTML 渲染功能')
  .tag('test', 'render')
  .param('type', { 
    type: 'string', 
    description: '测试类型: simple, card, gradient, complex',
    enum: ['simple', 'card', 'gradient', 'complex']
  })
  .execute(async ({ type = 'simple' }) => {
    const renderer = getRenderer();
    if (!renderer) {
      return { success: false, error: 'html-renderer service not available' };
    }

    let html: string;
    let width = 400;

    switch (type) {
      case 'simple':
        html = `
          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 40px;
            background-color: #3b82f6;
            color: white;
            font-size: 24px;
            border-radius: 12px;
          ">
            Hello from @zhinjs/satori! 🎉
          </div>
        `;
        break;

      case 'card':
        html = `
          <div style="
            display: flex;
            flex-direction: column;
            padding: 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px;
            color: white;
          ">
            <div style="font-size: 28px; font-weight: bold; margin-bottom: 16px;">
              🤖 Zhin.js
            </div>
            <div style="font-size: 16px; opacity: 0.9; line-height: 1.6;">
              一个现代化的机器人框架，支持多平台、AI 集成、HTML 渲染等功能。
            </div>
            <div style="
              display: flex;
              margin-top: 20px;
              padding-top: 16px;
              border-top: 1px solid rgba(255,255,255,0.2);
              font-size: 14px;
              opacity: 0.7;
            ">
              Powered by @zhinjs/satori
            </div>
          </div>
        `;
        break;

      case 'gradient':
        html = `
          <div style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px;
            background: linear-gradient(45deg, #ff6b6b, #feca57, #48dbfb, #ff9ff3);
            border-radius: 20px;
          ">
            <div style="
              font-size: 48px;
              font-weight: bold;
              color: white;
              text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            ">
              🌈 Gradient Test
            </div>
            <div style="
              font-size: 18px;
              color: white;
              margin-top: 16px;
              opacity: 0.9;
            ">
              Beautiful colors powered by CSS gradients
            </div>
          </div>
        `;
        width = 500;
        break;

      case 'complex':
        html = `
          <div style="
            display: flex;
            flex-direction: column;
            padding: 24px;
            background-color: #1a1a2e;
            border-radius: 16px;
            color: white;
          ">
            <div style="
              display: flex;
              align-items: center;
              margin-bottom: 20px;
            ">
              <div style="
                width: 48px;
                height: 48px;
                background: linear-gradient(135deg, #00d9ff, #0066ff);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                margin-right: 16px;
              ">
                🤖
              </div>
              <div style="display: flex; flex-direction: column;">
                <div style="font-size: 18px; font-weight: bold;">AI Assistant</div>
                <div style="font-size: 12px; color: #888;">Online</div>
              </div>
            </div>
            
            <div style="
              background-color: #16213e;
              padding: 16px;
              border-radius: 12px;
              font-size: 14px;
              line-height: 1.6;
            ">
              这是一个复杂布局的示例，展示了 @zhinjs/satori 的能力：
              <ul style="margin-top: 12px; padding-left: 20px;">
                <li style="margin-bottom: 8px;">✅ Flexbox 布局</li>
                <li style="margin-bottom: 8px;">✅ 渐变背景</li>
                <li style="margin-bottom: 8px;">✅ 圆角边框</li>
                <li style="margin-bottom: 8px;">✅ 嵌套元素</li>
                <li>✅ 中文支持</li>
              </ul>
            </div>
            
            <div style="
              display: flex;
              justify-content: space-between;
              margin-top: 16px;
              font-size: 12px;
              color: #666;
            ">
              <span>Rendered at ${new Date().toLocaleString('zh-CN')}</span>
              <span>v0.0.1</span>
            </div>
          </div>
        `;
        width = 450;
        break;

      default:
        return { success: false, error: `Unknown type: ${type}` };
    }

    try {
      const result = await renderer.render(html, {
        width,
        format: 'png',
      });

      const base64 = (result.data as Buffer).toString('base64');
      
      // 保存到本地文件
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `render-${type}-${timestamp}.png`;
      const filepath = join(OUTPUT_DIR, filename);
      
      writeFileSync(filepath, result.data as Buffer);
      logger.info(`Render result saved to: ${filepath}`);

      return {
        success: true,
        type,
        width: result.width,
        height: result.height,
        base64,
        dataUrl: `data:${result.mimeType};base64,${base64}`,
        savedTo: filepath,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .action(async (message, result) => {
    const type = (result.params.type as string) || 'simple';
    
    const renderer = getRenderer();
    if (!renderer) {
      return '❌ html-renderer 服务不可用';
    }

    try {
      const executeResult = await testRenderTool.toTool().execute(
        { type },
        { platform: message.$adapter, senderId: message.$sender.id }
      );

      if (!executeResult.success) {
        return `❌ 渲染失败: ${executeResult.error}`;
      }

      return <image url={executeResult.dataUrl} />;
    } catch (error) {
      return `❌ 渲染失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

// 注册工具
const toolService = plugin.root.inject('tool' as any) as any;
if (toolService) {
  toolService.addTool(testRenderTool, plugin.name, true);
}

logger.debug('HTML test plugin loaded');
