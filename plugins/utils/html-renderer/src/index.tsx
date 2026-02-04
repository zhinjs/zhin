/**
 * HTML 渲染器插件
 * 
 * 使用 @zhinjs/satori 将 HTML/CSS 转换为 SVG，
 * 使用 @resvg/resvg-js 将 SVG 转换为 PNG
 */

import { usePlugin, defineComponent, ZhinTool } from "zhin.js";
import satori, { getDefaultFonts, type BuiltinFont } from '@zhinjs/satori';
import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import type { 
  HtmlRendererConfig, 
  HtmlRendererService, 
  RenderOptions, 
  RenderResult, 
  FontConfig,
  OutputFormat 
} from './types.js';

// ============================================================================
// 插件初始化
// ============================================================================

const plugin = usePlugin();
const { logger, provide, addComponent } = plugin;

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_CONFIG: Required<HtmlRendererConfig> = {
  defaultWidth: 800,
  defaultFonts: [],
  defaultBackgroundColor: '#ffffff',
  cacheFonts: true,
  fontUrls: [],
};

// ============================================================================
// 字体管理
// ============================================================================

// 字体缓存
const fontCache: Map<string, FontConfig> = new Map();

// 默认字体加载状态
let defaultFontLoaded = false;

/**
 * 加载默认字体（使用 @zhinjs/satori 内置字体）
 */
async function loadDefaultFont(): Promise<FontConfig | null> {
  if (defaultFontLoaded) {
    const cached = fontCache.get('default');
    return cached || null;
  }

  try {
    // 使用 @zhinjs/satori 内置的字体
    const builtinFonts = getDefaultFonts();
    
    if (builtinFonts.length > 0) {
      // 注册所有内置字体
      for (const font of builtinFonts) {
        const fontConfig: FontConfig = {
          name: font.name,
          data: font.data,
          weight: font.weight,
          style: font.style,
        };
        fontCache.set(`${font.name}-${font.weight}`, fontConfig);
        logger.debug(`Builtin font registered: ${font.name} (${Math.round(font.data.byteLength / 1024)}KB)`);
      }
      
      // 设置第一个字体为默认
      const defaultFont = builtinFonts[0];
      const defaultFontConfig: FontConfig = {
        name: defaultFont.name,
        data: defaultFont.data,
        weight: defaultFont.weight,
        style: defaultFont.style,
      };
      
      fontCache.set('default', defaultFontConfig);
      defaultFontLoaded = true;
      
      logger.info(`Default fonts loaded from @zhinjs/satori: ${builtinFonts.map(f => f.name).join(', ')}`);
      return defaultFontConfig;
    }
  } catch (error) {
    logger.warn('Failed to load builtin fonts:', error);
  }

  logger.warn('No fonts available');
  defaultFontLoaded = true;
  return null;
}

/**
 * 从 URL 加载字体
 */
async function loadFontFromUrl(url: string, name: string, weight: FontConfig['weight'] = 400): Promise<FontConfig | null> {
  try {
    const cacheKey = `${name}-${weight}`;
    
    if (fontCache.has(cacheKey)) {
      return fontCache.get(cacheKey)!;
    }
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch font: ${response.status}`);
    }
    
    const fontData = await response.arrayBuffer();
    
    const font: FontConfig = {
      name,
      data: fontData,
      weight,
      style: 'normal',
    };
    
    fontCache.set(cacheKey, font);
    logger.debug(`Font loaded from URL: ${name}`);
    
    return font;
  } catch (error) {
    logger.warn(`Failed to load font from ${url}:`, error);
    return null;
  }
}

// ============================================================================
// Emoji 支持
// ============================================================================

/**
 * 将 emoji 代码点转换为 Twemoji URL
 */
function emojiToTwemojiUrl(emoji: string): string {
  // 获取 emoji 的代码点
  const codePoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp) {
      // 跳过变体选择器 (FE0F)
      if (cp !== 0xfe0f) {
        codePoints.push(cp.toString(16));
      }
    }
  }
  
  const filename = codePoints.join('-');
  // 使用 jsDelivr CDN 的 Twemoji
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${filename}.svg`;
}

/**
 * 加载 emoji 图片
 */
async function loadEmojiImage(emoji: string): Promise<string | null> {
  try {
    const url = emojiToTwemojiUrl(emoji);
    const response = await fetch(url);
    
    if (!response.ok) {
      logger.debug(`Failed to load emoji ${emoji}: ${response.status}`);
      return null;
    }
    
    const svg = await response.text();
    // 转换为 data URL
    const base64 = Buffer.from(svg).toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
  } catch (error) {
    logger.debug(`Failed to load emoji ${emoji}:`, error);
    return null;
  }
}

// Emoji 缓存
const emojiCache: Map<string, string> = new Map();

/**
 * 加载额外资源（字体和 emoji）
 */
async function loadAdditionalAsset(
  languageCode: string,
  segment: string
): Promise<string | null> {
  // 如果是 emoji
  if (languageCode === 'emoji') {
    // 检查缓存
    if (emojiCache.has(segment)) {
      return emojiCache.get(segment)!;
    }
    
    const result = await loadEmojiImage(segment);
    if (result) {
      emojiCache.set(segment, result);
    }
    return result;
  }
  
  // 其他语言代码暂不处理
  return null;
}

// ============================================================================
// 渲染引擎
// ============================================================================

/**
 * 将 HTML 包装为完整的 HTML 文档
 */
function wrapHtml(html: string, backgroundColor: string = '#ffffff'): string {
  // 如果已经是完整 HTML，直接返回
  if (html.includes('<!DOCTYPE') || html.includes('<html')) {
    return html;
  }
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      display: flex;
      flex-direction: column;
      background-color: ${backgroundColor};
      font-family: "Noto Sans SC", sans-serif;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;
}

/**
 * 渲染 HTML 为 SVG（使用 @zhinjs/satori 的 JSDOM 方式）
 */
async function renderHtmlToSvg(
  html: string,
  width: number,
  height: number | undefined,
  fonts: FontConfig[],
  backgroundColor?: string
): Promise<{ svg: string; width: number; height: number }> {
  // 确保至少有一个字体
  let finalFonts = fonts;
  if (finalFonts.length === 0) {
    const defaultFont = await loadDefaultFont();
    if (defaultFont) {
      finalFonts = [defaultFont];
    }
  }

  if (finalFonts.length === 0) {
    logger.warn('No fonts available, rendering may fail for non-ASCII characters');
  }

  // 包装 HTML
  const wrappedHtml = wrapHtml(html, backgroundColor);
  
  // 使用 JSDOM 解析 HTML
  const dom = new JSDOM(wrappedHtml);

  // 使用 @zhinjs/satori 渲染
  const satoriOptions: any = {
    width,
    fonts: finalFonts.map(f => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
    // 支持 emoji 加载
    loadAdditionalAsset,
  };
  
  if (height) {
    satoriOptions.height = height;
  }

  const svg = await satori(dom, satoriOptions);

  // 从 SVG 中解析实际尺寸
  const widthMatch = svg.match(/width="(\d+)"/);
  const heightMatch = svg.match(/height="(\d+)"/);
  
  const actualWidth = widthMatch ? parseInt(widthMatch[1], 10) : width;
  const actualHeight = heightMatch ? parseInt(heightMatch[1], 10) : height || width;

  return { svg, width: actualWidth, height: actualHeight };
}

/**
 * 将 SVG 转换为 PNG
 */
function svgToPng(svg: string, scale: number = 1): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: scale !== 1 ? {
      mode: 'zoom',
      value: scale,
    } : undefined,
  });
  
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

// ============================================================================
// 渲染服务
// ============================================================================

/**
 * 创建渲染服务
 */
function createHtmlRendererService(config: HtmlRendererConfig = {}): HtmlRendererService {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  // 注册默认字体
  for (const font of mergedConfig.defaultFonts) {
    fontCache.set(`${font.name}-${font.weight || 400}`, font);
  }
  
  return {
    async render(html: string, options: RenderOptions = {}): Promise<RenderResult> {
      const {
        width = mergedConfig.defaultWidth,
        height,
        format = 'png',
        backgroundColor = mergedConfig.defaultBackgroundColor,
        fonts = [],
        scale = 1,
      } = options;

      // 合并字体
      const allFonts = [
        ...Array.from(fontCache.values()),
        ...fonts,
      ];

      // 渲染为 SVG
      const { svg, width: actualWidth, height: actualHeight } = await renderHtmlToSvg(
        html,
        width,
        height,
        allFonts,
        backgroundColor
      );

      if (format === 'svg') {
        return {
          data: svg,
          format: 'svg',
          width: actualWidth,
          height: actualHeight,
          mimeType: 'image/svg+xml',
        };
      }

      // 转换为 PNG
      const png = svgToPng(svg, scale);
      
      return {
        data: png,
        format: 'png',
        width: Math.round(actualWidth * scale),
        height: Math.round(actualHeight * scale),
        mimeType: 'image/png',
      };
    },

    // renderJsx 保留用于向后兼容，但内部转换为 HTML
    async renderJsx(element: JSX.Element, options: RenderOptions = {}): Promise<RenderResult> {
      // 将 JSX 元素序列化为 HTML（简化实现）
      const html = serializeJsxToHtml(element);
      return this.render(html, options);
    },

    registerFont(font: FontConfig): void {
      const key = `${font.name}-${font.weight || 400}`;
      fontCache.set(key, font);
      logger.debug(`Font registered: ${font.name}`);
    },

    getFonts(): FontConfig[] {
      return Array.from(fontCache.values());
    },

    clearFonts(): void {
      fontCache.clear();
      defaultFontLoaded = false;
      logger.debug('Font cache cleared');
    },
  };
}

/**
 * 简单的 JSX 到 HTML 序列化（用于向后兼容）
 */
function serializeJsxToHtml(element: any): string {
  if (typeof element === 'string' || typeof element === 'number') {
    return String(element);
  }
  
  if (element === null || element === undefined) {
    return '';
  }
  
  if (Array.isArray(element)) {
    return element.map(serializeJsxToHtml).join('');
  }
  
  if (typeof element === 'object' && element.type) {
    const { type, props = {} } = element;
    const { children, style, ...restProps } = props;
    
    // 处理样式
    let styleStr = '';
    if (style && typeof style === 'object') {
      styleStr = Object.entries(style)
        .map(([key, value]) => {
          // 转换 camelCase 到 kebab-case
          const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
          return `${cssKey}: ${value}`;
        })
        .join('; ');
    }
    
    // 构建属性字符串
    const attrs = Object.entries(restProps)
      .filter(([key]) => key !== 'dangerouslySetInnerHTML')
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    
    const styleAttr = styleStr ? ` style="${styleStr}"` : '';
    const attrStr = attrs ? ` ${attrs}` : '';
    
    // 处理 dangerouslySetInnerHTML
    if (props.dangerouslySetInnerHTML && props.dangerouslySetInnerHTML.__html) {
      return `<${type}${attrStr}${styleAttr}>${props.dangerouslySetInnerHTML.__html}</${type}>`;
    }
    
    // 处理子元素
    const childrenHtml = children ? serializeJsxToHtml(children) : '';
    
    // 自闭合标签
    const selfClosingTags = ['img', 'br', 'hr', 'input', 'meta', 'link'];
    if (selfClosingTags.includes(type) && !childrenHtml) {
      return `<${type}${attrStr}${styleAttr} />`;
    }
    
    return `<${type}${attrStr}${styleAttr}>${childrenHtml}</${type}>`;
  }
  
  return '';
}

// ============================================================================
// 注册服务
// ============================================================================

// 获取配置
const configService = plugin.root.inject('config');
const appConfig = configService?.get<{ htmlRenderer?: HtmlRendererConfig }>('zhin.config.yml') || {};
const pluginConfig = appConfig.htmlRenderer || {};

// 创建服务实例
const rendererService = createHtmlRendererService(pluginConfig);

// 注册为 Context
(provide as any)({
  name: 'html-renderer',
  description: 'HTML to image rendering service using @zhinjs/satori',
  value: rendererService,
});

logger.info('HTML Renderer service registered (using @zhinjs/satori)');

// ============================================================================
// JSX 组件
// ============================================================================

/**
 * 渲染 HTML 为图片的组件
 */
const RenderImage = defineComponent(async function RenderImage(props: {
  children?: any;
  html?: string;
  width?: number;
  height?: number;
  format?: OutputFormat;
  backgroundColor?: string;
  scale?: number;
}) {
  const { children, html, width, height, format = 'png', backgroundColor, scale } = props;

  try {
    let result: RenderResult;

    if (html) {
      result = await rendererService.render(html, { width, height, format, backgroundColor, scale });
    } else if (children) {
      result = await rendererService.renderJsx(children, { width, height, format, backgroundColor, scale });
    } else {
      return '❌ 未提供渲染内容';
    }

    if (result.format === 'svg') {
      return `[SVG 图片 ${result.width}x${result.height}]`;
    }

    // 转换为 base64 URL
    const base64 = (result.data as Buffer).toString('base64');
    const dataUrl = `data:${result.mimeType};base64,${base64}`;

    return <image url={dataUrl} />;
  } catch (error) {
    logger.error('RenderImage error:', error);
    return `❌ 渲染失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}, 'RenderImage');

addComponent(RenderImage);

// ============================================================================
// AI 工具
// ============================================================================

/**
 * HTML 渲染工具 - 供 AI 使用
 */
const renderHtmlTool = new ZhinTool('html.render')
  .desc('将 HTML/CSS 代码渲染为图片')
  .tag('render', 'image', 'html')
  .param('html', { type: 'string', description: 'HTML 代码（支持内联 CSS 样式）' }, true)
  .param('width', { type: 'number', description: '图片宽度（像素，默认 800）' })
  .param('height', { type: 'number', description: '图片高度（像素，自动计算）' })
  .param('backgroundColor', { type: 'string', description: '背景颜色（默认 #ffffff）' })
  .execute(async ({ html, width, height, backgroundColor }) => {
    try {
      const result = await rendererService.render(
        html as string,
        {
          width: width as number | undefined,
          height: height as number | undefined,
          backgroundColor: backgroundColor as string | undefined,
          format: 'png',
        }
      );

      // 转换为 base64
      const base64 = (result.data as Buffer).toString('base64');

      return {
        success: true,
        width: result.width,
        height: result.height,
        format: result.format,
        base64,
        dataUrl: `data:${result.mimeType};base64,${base64}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .action(async (message, result) => {
    const html = result.params.html as string;
    const width = result.params.width as number | undefined;
    const height = result.params.height as number | undefined;
    const backgroundColor = result.params.backgroundColor as string | undefined;

    try {
      const renderResult = await rendererService.render(html, {
        width,
        height,
        backgroundColor,
        format: 'png',
      });

      const base64 = (renderResult.data as Buffer).toString('base64');
      const dataUrl = `data:${renderResult.mimeType};base64,${base64}`;

      return <image url={dataUrl} />;
    } catch (error) {
      return `❌ 渲染失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

// 注册工具
const toolService = plugin.root.inject('tool');
if (toolService) {
  toolService.add(renderHtmlTool, plugin.name);
  logger.debug('HTML render tool registered');
}

/**
 * 生成卡片图片工具 - 供 AI 使用
 */
const generateCardTool = new ZhinTool('html.card')
  .desc('生成美观的卡片图片（自动生成 HTML）')
  .tag('render', 'image', 'card')
  .param('title', { type: 'string', description: '卡片标题' }, true)
  .param('content', { type: 'string', description: '卡片内容（支持多行）' }, true)
  .param('theme', { 
    type: 'string', 
    description: '主题颜色: blue, green, purple, orange, red（默认 blue）',
    enum: ['blue', 'green', 'purple', 'orange', 'red']
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
      const result = await rendererService.render(html, {
        width: width as number,
        format: 'png',
      });

      const base64 = (result.data as Buffer).toString('base64');

      return {
        success: true,
        width: result.width,
        height: result.height,
        base64,
        dataUrl: `data:${result.mimeType};base64,${base64}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  })
  .action(async (message, result) => {
    const { title, content, theme, width } = result.params;
    
    // 执行 execute 获取结果
    const executeResult = await generateCardTool.toTool().execute(
      { title, content, theme, width },
      { platform: message.$adapter, senderId: message.$sender.id }
    );

    if (!executeResult.success) {
      return `❌ 生成失败: ${executeResult.error}`;
    }

    return <image url={executeResult.dataUrl} />;
  });

// 注册卡片工具
if (toolService) {
  toolService.add(generateCardTool, plugin.name);
  logger.debug('HTML card tool registered');
}

// ============================================================================
// 导出
// ============================================================================

export type { 
  HtmlRendererConfig, 
  HtmlRendererService, 
  RenderOptions, 
  RenderResult, 
  FontConfig,
  OutputFormat,
} from './types.js';

export { rendererService, RenderImage };

// 声明 Context 类型
declare module 'zhin.js' {
  namespace Plugin {
    interface Contexts {
      'html-renderer': HtmlRendererService;
    }
  }
}
