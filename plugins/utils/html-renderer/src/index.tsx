/**
 * HTML → 图片：@zhin.js/satori（htmlToSvg）+ @resvg/resvg-js（PNG）
 */

import { usePlugin, defineComponent, ZhinTool } from "zhin.js";
import { htmlToSvg, getAllBuiltinFonts } from '@zhin.js/satori';
import { Resvg } from '@resvg/resvg-js';
import type {
  HtmlRendererConfig,
  HtmlRendererService,
  RenderOptions,
  RenderResult,
  FontConfig,
  OutputFormat,
} from './types.js';
import { registerAiTextAsImageOutput } from './ai-text-as-image.js';

const plugin = usePlugin();
const { logger, provide, addComponent, root } = plugin;

const DEFAULT_CONFIG: Required<HtmlRendererConfig> = {
  defaultWidth: 800,
  defaultFonts: [],
  defaultBackgroundColor: '#ffffff',
  cacheFonts: true,
  fontUrls: [],
  aiTextAsImage: false,
};

const fontCache: Map<string, FontConfig> = new Map();
let defaultFontLoaded = false;

function toFontConfig(f: { name: string; data: ArrayBuffer | Buffer; weight?: FontConfig['weight']; style?: FontConfig['style'] }): FontConfig {
  return { name: f.name, data: f.data, weight: f.weight, style: f.style };
}

/** 合并字体：同名同 weight 同 style **后者覆盖前者**（便于 options.fonts 覆盖缓存） */
function uniqueFontsForRender(list: FontConfig[]): FontConfig[] {
  const m = new Map<string, FontConfig>();
  for (const f of list) {
    const k = `${f.name}\0${f.weight ?? 400}\0${f.style ?? 'normal'}`;
    m.set(k, f);
  }
  return [...m.values()];
}

/** 多段列表依次合并，**后出现的同键覆盖** */
function mergeFontLists(...lists: FontConfig[][]): FontConfig[] {
  const flat: FontConfig[] = [];
  for (const list of lists) flat.push(...list);
  return uniqueFontsForRender(flat);
}

/**
 * 同步把 @zhin.js/satori 内置轮廓字写入 fontCache，并保证任意一次 render 前已执行。
 * 避免「fontCache 里已有部分字体 → allFonts 非空 → 未合并 CJK → 第一次中文豆腐块、第二次才对」。
 */
function ensureBuiltinFontsCached(): void {
  if (defaultFontLoaded) return;

  try {
    const builtinFonts = getAllBuiltinFonts();
    if (builtinFonts.length > 0) {
      for (const font of builtinFonts) {
        const fc = toFontConfig(font);
        fontCache.set(`${font.name}-${font.weight}`, fc);
        logger.debug(`Builtin font: ${font.name} (${Math.round(font.data.byteLength / 1024)}KB)`);
      }
      fontCache.set('default', toFontConfig(builtinFonts[0]));
      defaultFontLoaded = true;
      logger.info(`Default fonts: ${builtinFonts.map((f) => f.name).join(', ')}`);
      return;
    }
  } catch (e) {
    logger.warn('Builtin fonts failed:', e);
  }
  defaultFontLoaded = true;
  logger.warn('No fonts available');
}

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

function emojiToTwemojiUrl(emoji: string): string {
  const codePoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp && cp !== 0xfe0f) codePoints.push(cp.toString(16));
  }
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join('-')}.svg`;
}

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

const emojiCache: Map<string, string> = new Map();

async function loadAdditionalAsset(
  languageCode: string,
  segment: string
): Promise<string | null> {
  if (languageCode === 'emoji') {
    if (emojiCache.has(segment)) return emojiCache.get(segment)!;
    const result = await loadEmojiImage(segment);
    if (result) emojiCache.set(segment, result);
    return result;
  }
  return null;
}

/** 片段包一层根节点（satori 用内联样式即可，不必整页 HTML + &lt;style&gt;） */
function wrapHtmlFragment(html: string, backgroundColor: string): string {
  if (html.includes('<!DOCTYPE') || html.includes('<html')) return html;
  return `<div style="display:flex;flex-direction:column;width:100%;height:100%;margin:0;padding:0;box-sizing:border-box;background-color:${backgroundColor};font-family:Noto Sans SC,sans-serif">${html}</div>`;
}

async function renderHtmlToSvg(
  html: string,
  width: number,
  height: number | undefined,
  fonts: FontConfig[],
  backgroundColor?: string
): Promise<{ svg: string; width: number; height: number }> {
  ensureBuiltinFontsCached();
  /** 无论调用方是否已带字体，都先铺一层内置 CJK+拉丁，再叠缓存/ options（后者可覆盖同名） */
  const finalFonts = mergeFontLists(getAllBuiltinFonts().map(toFontConfig), fonts);
  if (finalFonts.length === 0) {
    logger.warn('No fonts: non-ASCII text may fail');
  }

  const svg = await htmlToSvg(wrapHtmlFragment(html, backgroundColor ?? '#ffffff'), {
    width,
    ...(height != null && { height }),
    fonts: finalFonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
    loadAdditionalAsset: async (code, seg) => (await loadAdditionalAsset(code, seg)) ?? '',
  });

  const wm = svg.match(/width="(\d+)"/);
  const hm = svg.match(/height="(\d+)"/);
  return {
    svg,
    width: wm ? parseInt(wm[1], 10) : width,
    height: hm ? parseInt(hm[1], 10) : height || width,
  };
}

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

function createHtmlRendererService(config: HtmlRendererConfig = {}): HtmlRendererService {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  /** 先内置字库，再写配置里的 defaultFonts，同名同 weight 时以配置为准 */
  ensureBuiltinFontsCached();
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

      ensureBuiltinFontsCached();
      const allFonts = uniqueFontsForRender([...fontCache.values(), ...fonts]);

      const { svg, width: actualWidth, height: actualHeight } = await renderHtmlToSvg(
        html,
        width,
        height,
        allFonts,
        backgroundColor
      );

      if (format === 'svg') {
        return { data: svg, format: 'svg', width: actualWidth, height: actualHeight, mimeType: 'image/svg+xml' };
      }

      const png = svgToPng(svg, scale);
      
      return {
        data: png,
        format: 'png',
        width: Math.round(actualWidth * scale),
        height: Math.round(actualHeight * scale),
        mimeType: 'image/png',
      };
    },

    async renderJsx(element: JSX.Element, options: RenderOptions = {}): Promise<RenderResult> {
      return this.render(serializeJsxToHtml(element), options);
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
    
    let styleStr = '';
    if (style && typeof style === 'object') {
      styleStr = Object.entries(style)
        .map(([key, value]) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${value}`)
        .join('; ');
    }

    const attrs = Object.entries(restProps)
      .filter(([key]) => key !== 'dangerouslySetInnerHTML')
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    
    const styleAttr = styleStr ? ` style="${styleStr}"` : '';
    const attrStr = attrs ? ` ${attrs}` : '';

    if (props.dangerouslySetInnerHTML?.__html) {
      return `<${type}${attrStr}${styleAttr}>${props.dangerouslySetInnerHTML.__html}</${type}>`;
    }

    const childrenHtml = children ? serializeJsxToHtml(children) : '';
    const selfClosingTags = ['img', 'br', 'hr', 'input', 'meta', 'link'];
    if (selfClosingTags.includes(type) && !childrenHtml) {
      return `<${type}${attrStr}${styleAttr} />`;
    }
    
    return `<${type}${attrStr}${styleAttr}>${childrenHtml}</${type}>`;
  }
  
  return '';
}

const configService = plugin.root.inject('config');
const appConfig = configService?.get<{ htmlRenderer?: HtmlRendererConfig }>('zhin.config.yml') || {};
const pluginConfig = appConfig.htmlRenderer || {};
const mergedHtmlRendererConfig: HtmlRendererConfig = { ...DEFAULT_CONFIG, ...pluginConfig };
const rendererService = createHtmlRendererService(pluginConfig);

registerAiTextAsImageOutput({
  root,
  logger,
  fullConfig: mergedHtmlRendererConfig,
  getRenderer: () => rendererService,
});

(provide as any)({
  name: 'html-renderer',
  description: 'HTML → image (satori + resvg)',
  value: rendererService,
});
logger.debug('html-renderer service registered');

/** PNG 渲染并生成 data URL（供工具复用） */
async function renderPngPayload(
  html: string,
  opts: Pick<RenderOptions, 'width' | 'height' | 'backgroundColor' | 'scale'> = {}
) {
  const result = await rendererService.render(html, { ...opts, format: 'png' });
  const base64 = (result.data as Buffer).toString('base64');
  return {
    width: result.width,
    height: result.height,
    format: result.format,
    base64,
    dataUrl: `data:${result.mimeType};base64,${base64}`,
  };
}

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

const renderHtmlTool = new ZhinTool('html_render')
  .desc('将 HTML/CSS 代码渲染为图片')
  .tag('render', 'image', 'html')
  .param('html', { type: 'string', description: 'HTML 代码（支持内联 CSS 样式）' }, true)
  .param('width', { type: 'number', description: '图片宽度（像素，默认 800）' })
  .param('height', { type: 'number', description: '图片高度（像素，自动计算）' })
  .param('backgroundColor', { type: 'string', description: '背景颜色（默认 #ffffff）' })
  .execute(async ({ html, width, height, backgroundColor }) => {
    try {
      const p = await renderPngPayload(html as string, {
        width: width as number | undefined,
        height: height as number | undefined,
        backgroundColor: backgroundColor as string | undefined,
      });
      return { success: true, ...p };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .action(async (_message, result) => {
    try {
      const p = await renderPngPayload(result.params.html as string, {
        width: result.params.width as number | undefined,
        height: result.params.height as number | undefined,
        backgroundColor: result.params.backgroundColor as string | undefined,
      });
      return <image url={p.dataUrl} />;
    } catch (error) {
      return `❌ 渲染失败: ${error instanceof Error ? error.message : String(error)}`;
    }
  });

const toolService = plugin.root.inject('tool');
if (toolService) {
  toolService.addTool(renderHtmlTool, plugin.name);
}

const generateCardTool = new ZhinTool('html_card')
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
      const p = await renderPngPayload(html, { width: width as number });
      return { success: true, width: p.width, height: p.height, base64: p.base64, dataUrl: p.dataUrl };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  })
  .action(async (message, result) => {
    const { title, content, theme, width } = result.params;
    
    const executeResult = await generateCardTool.toTool().execute(
      { title, content, theme, width },
      { platform: message.$adapter, senderId: message.$sender.id }
    ) as { success: boolean; error?: string; dataUrl?: string } | null | undefined;

    if (!executeResult || !executeResult.success) {
      return `❌ 生成失败: ${executeResult?.error ?? '未知错误'}`;
    }

    return <image url={executeResult.dataUrl!} />;
  });

if (toolService) {
  toolService.addTool(generateCardTool, plugin.name);
}

export type { 
  HtmlRendererConfig, 
  HtmlRendererAiTextAsImageConfig,
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
