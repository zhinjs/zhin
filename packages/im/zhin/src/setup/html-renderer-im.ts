import { defineComponent, segment, ZhinTool } from '@zhin.js/core';
import type { Plugin } from '@zhin.js/core';
import type {
  HtmlRendererService,
  OutputFormat,
  RenderOptions,
} from '@zhin.js/html-renderer';

async function renderPngPayload(
  renderer: HtmlRendererService,
  html: string,
  opts: Pick<RenderOptions, 'width' | 'height' | 'backgroundColor' | 'scale'> = {},
) {
  const result = await renderer.render(html, { ...opts, format: 'png' });
  const base64 = (result.data as Buffer).toString('base64');
  return {
    width: result.width,
    height: result.height,
    format: result.format,
    base64,
    dataUrl: `data:${result.mimeType};base64,${base64}`,
  };
}

/**
 * 安装 @zhin.js/html-renderer 后注册 IM 侧能力：RenderImage 组件、Agent 工具、html-renderer Context。
 */
export function registerHtmlRendererImIntegration(
  plugin: Plugin,
  renderer: HtmlRendererService,
): () => void {
  const cleanups: (() => void)[] = [];

  plugin.provide({
    name: 'html-renderer',
    description: 'HTML → image (satori + resvg)',
    value: renderer,
  });

  const componentFeature = plugin.inject('component');
  if (componentFeature) {
    const RenderImage = defineComponent(async function RenderImage(props: {
      children?: unknown;
      html?: string;
      width?: number;
      height?: number;
      format?: OutputFormat;
      backgroundColor?: string;
      scale?: number;
    }) {
      const { children, html, width, height, format = 'png', backgroundColor, scale } = props;

      try {
        if (html) {
          const result = await renderer.render(html, { width, height, format, backgroundColor, scale });
          if (result.format === 'svg') {
            return `[SVG 图片 ${result.width}x${result.height}]`;
          }
          const base64 = (result.data as Buffer).toString('base64');
          return segment('image', { url: `data:${result.mimeType};base64,${base64}` });
        }

        if (children != null) {
          const result = await renderer.renderJsx(children, { width, height, format, backgroundColor, scale });
          if (result.format === 'svg') {
            return `[SVG 图片 ${result.width}x${result.height}]`;
          }
          const base64 = (result.data as Buffer).toString('base64');
          return segment('image', { url: `data:${result.mimeType};base64,${base64}` });
        }

        return '❌ 未提供渲染内容';
      } catch (error) {
        plugin.logger.error('RenderImage error:', error);
        return `❌ 渲染失败: ${error instanceof Error ? error.message : String(error)}`;
      }
    }, 'RenderImage');

    cleanups.push(componentFeature.add(RenderImage, 'html-renderer'));
    plugin.logger.debug('html-renderer: RenderImage 组件已注册');
  } else {
    plugin.logger.debug('html-renderer: component 服务未启用，跳过 RenderImage');
  }

  const toolService = plugin.root.inject('tool' as keyof Plugin.Contexts) as
    | { addTool: (tool: ZhinTool, pluginName: string) => void }
    | undefined;

  if (toolService) {
    const renderHtmlTool = new ZhinTool('html_render')
      .desc('将 HTML/CSS 代码渲染为图片')
      .tag('render', 'image', 'html')
      .param('html', { type: 'string', description: 'HTML 代码（支持内联 CSS 样式）' }, true)
      .param('width', { type: 'number', description: '图片宽度（像素，默认 800）' })
      .param('height', { type: 'number', description: '图片高度（像素，自动计算）' })
      .param('backgroundColor', { type: 'string', description: '背景颜色（默认 #ffffff）' })
      .execute(async ({ html, width, height, backgroundColor }) => {
        try {
          const p = await renderPngPayload(renderer, html as string, {
            width: width as number | undefined,
            height: height as number | undefined,
            backgroundColor: backgroundColor as string | undefined,
          });
          return { success: true, ...p };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      });

    const generateCardTool = new ZhinTool('html_card')
      .desc('生成美观的卡片图片（自动生成 HTML）')
      .tag('render', 'image', 'card')
      .param('title', { type: 'string', description: '卡片标题' }, true)
      .param('content', { type: 'string', description: '卡片内容（支持多行）' }, true)
      .param('theme', {
        type: 'string',
        description: '主题颜色: blue, green, purple, orange, red（默认 blue）',
        enum: ['blue', 'green', 'purple', 'orange', 'red'],
      })
      .param('width', { type: 'number', description: '卡片宽度（像素，默认 400）' })
      .execute(async ({ title, content, theme = 'blue', width = 400 }) => {
        const themeColors: Record<string, { bg: string; accent: string; text: string }> = {
          blue: { bg: '#f0f9ff', accent: '#3b82f6', text: '#1e3a5f' },
          green: { bg: '#f0fdf4', accent: '#22c55e', text: '#14532d' },
          purple: { bg: '#faf5ff', accent: '#a855f7', text: '#3b0764' },
          orange: { bg: '#fff7ed', accent: '#f97316', text: '#7c2d12' },
          red: { bg: '#fef2f2', accent: '#ef4444', text: '#7f1d1d' },
        };

        const colors = themeColors[theme as string] || themeColors.blue;
        const html = `
<div style="
  display: flex;
  flex-direction: column;
  padding: 24px;
  background: linear-gradient(135deg, ${colors.bg} 0%, white 100%);
  border-radius: 16px;
  border-left: 4px solid ${colors.accent};
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
">
  <div style="
    font-size: 24px;
    font-weight: bold;
    color: ${colors.text};
    margin-bottom: 12px;
  ">${title}</div>
  <div style="
    font-size: 16px;
    color: #374151;
    line-height: 1.6;
    white-space: pre-wrap;
  ">${content}</div>
</div>`;

        try {
          const p = await renderPngPayload(renderer, html, { width: width as number });
          return { success: true, width: p.width, height: p.height, base64: p.base64, dataUrl: p.dataUrl };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      });

    toolService.addTool(renderHtmlTool, 'html-renderer');
    toolService.addTool(generateCardTool, 'html-renderer');
    plugin.logger.debug('html-renderer: html_render / html_card 工具已注册');
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
