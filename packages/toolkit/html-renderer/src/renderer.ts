import { htmlToSvg, getAllBuiltinFonts, h } from '@zhin.js/satori';
import type { HtmlComponent } from '@zhin.js/satori';
import { Resvg } from '@resvg/resvg-js';
import type {
  FontConfig,
  HtmlRendererConfig,
  HtmlRendererLogger,
  HtmlRendererService,
  RenderOptions,
  RenderResult,
} from './types.js';

const DEFAULT_CONFIG: Required<Omit<HtmlRendererConfig, 'aiTextAsImage'>> = {
  defaultWidth: 800,
  defaultFonts: [],
  defaultBackgroundColor: '#ffffff',
  cacheFonts: true,
  fontUrls: [],
};

const fontCache: Map<string, FontConfig> = new Map();
let defaultFontLoaded = false;

function toFontConfig(f: {
  name: string;
  data: ArrayBuffer | Buffer;
  weight?: FontConfig['weight'];
  style?: FontConfig['style'];
}): FontConfig {
  return { name: f.name, data: f.data, weight: f.weight, style: f.style };
}

function uniqueFontsForRender(list: FontConfig[]): FontConfig[] {
  const m = new Map<string, FontConfig>();
  for (const f of list) {
    const k = `${f.name}\0${f.weight ?? 400}\0${f.style ?? 'normal'}`;
    m.set(k, f);
  }
  return [...m.values()];
}

function mergeFontLists(...lists: FontConfig[][]): FontConfig[] {
  const flat: FontConfig[] = [];
  for (const list of lists) flat.push(...list);
  return uniqueFontsForRender(flat);
}

function ensureBuiltinFontsCached(logger?: HtmlRendererLogger): void {
  if (defaultFontLoaded) return;

  try {
    const builtinFonts = getAllBuiltinFonts();
    if (builtinFonts.length > 0) {
      for (const font of builtinFonts) {
        const fc = toFontConfig(font);
        fontCache.set(`${font.name}-${font.weight}`, fc);
        logger?.debug?.(`Builtin font: ${font.name} (${Math.round(font.data.byteLength / 1024)}KB)`);
      }
      fontCache.set('default', toFontConfig(builtinFonts[0]));
      defaultFontLoaded = true;
      return;
    }
  } catch (e) {
    logger?.warn?.('html-renderer: builtin fonts failed', e);
  }
  defaultFontLoaded = true;
  logger?.warn?.('html-renderer: no builtin fonts available');
}

function emojiToTwemojiUrl(emoji: string): string {
  const codePoints: string[] = [];
  for (const char of emoji) {
    const cp = char.codePointAt(0);
    if (cp && cp !== 0xfe0f) codePoints.push(cp.toString(16));
  }
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${codePoints.join('-')}.svg`;
}

async function loadEmojiImage(emoji: string, logger?: HtmlRendererLogger): Promise<string | null> {
  try {
    const url = emojiToTwemojiUrl(emoji);
    const response = await fetch(url);
    if (!response.ok) {
      logger?.debug?.(`Failed to load emoji ${emoji}: ${response.status}`);
      return null;
    }
    const svg = await response.text();
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  } catch (error) {
    logger?.debug?.(`Failed to load emoji ${emoji}:`, error);
    return null;
  }
}

const emojiCache: Map<string, string> = new Map();

async function loadAdditionalAsset(
  languageCode: string,
  segment: string,
  logger?: HtmlRendererLogger,
): Promise<string | null> {
  if (languageCode === 'emoji') {
    if (emojiCache.has(segment)) return emojiCache.get(segment)!;
    const result = await loadEmojiImage(segment, logger);
    if (result) emojiCache.set(segment, result);
    return result;
  }
  return null;
}

function wrapHtmlFragment(html: string, backgroundColor: string): string {
  if (html.includes('<!DOCTYPE') || html.includes('<html')) return html;
  return `<div style="display:flex;flex-direction:column;width:100%;height:100%;margin:0;padding:0;box-sizing:border-box;background-color:${backgroundColor};font-family:Noto Sans SC,sans-serif">${html}</div>`;
}

async function renderHtmlToSvg(
  html: string,
  width: number,
  height: number | undefined,
  fonts: FontConfig[],
  backgroundColor: string | undefined,
  logger?: HtmlRendererLogger,
): Promise<{ svg: string; width: number; height: number }> {
  ensureBuiltinFontsCached(logger);
  const finalFonts = mergeFontLists(getAllBuiltinFonts().map(toFontConfig), fonts);
  if (finalFonts.length === 0) {
    logger?.warn?.('html-renderer: no fonts; non-ascii text may fail');
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
    loadAdditionalAsset: async (code, seg) =>
      (await loadAdditionalAsset(code, seg, logger)) ?? '',
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
    fitTo:
      scale !== 1
        ? {
            mode: 'zoom',
            value: scale,
          }
        : undefined,
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

function serializeJsxToHtml(element: unknown): string {
  if (typeof element === 'string' || typeof element === 'number') {
    return String(element);
  }
  if (element == null) return '';
  if (Array.isArray(element)) {
    return element.map(serializeJsxToHtml).join('');
  }
  if (typeof element === 'object' && element !== null && 'type' in element) {
    const { type, props = {} } = element as { type: string; props?: Record<string, unknown> };
    const { children, style, dangerouslySetInnerHTML, ...restProps } = props as {
      children?: unknown;
      style?: Record<string, unknown>;
      dangerouslySetInnerHTML?: { __html?: string };
    };

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

    if (dangerouslySetInnerHTML?.__html) {
      return `<${type}${attrStr}${styleAttr}>${dangerouslySetInnerHTML.__html}</${type}>`;
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

export function createHtmlRenderer(
  config: HtmlRendererConfig = {},
  logger?: HtmlRendererLogger,
): HtmlRendererService {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  ensureBuiltinFontsCached(logger);
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

      ensureBuiltinFontsCached(logger);
      const allFonts = uniqueFontsForRender([...fontCache.values(), ...fonts]);

      const { svg, width: actualWidth, height: actualHeight } = await renderHtmlToSvg(
        html,
        width,
        height,
        allFonts,
        backgroundColor,
        logger,
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

      const png = svgToPng(svg, scale);
      return {
        data: png,
        format: 'png',
        width: Math.round(actualWidth * scale),
        height: Math.round(actualHeight * scale),
        mimeType: 'image/png',
      };
    },

    async renderJsx(element: unknown, options: RenderOptions = {}): Promise<RenderResult> {
      return this.render(serializeJsxToHtml(element), options);
    },

    async renderComponent<P>(
      component: HtmlComponent<P>,
      props: P,
      options: RenderOptions = {},
    ): Promise<RenderResult> {
      return this.render(h(component, props), options);
    },

    registerFont(font: FontConfig): void {
      fontCache.set(`${font.name}-${font.weight || 400}`, font);
      logger?.debug?.(`Font registered: ${font.name}`);
    },

    getFonts(): FontConfig[] {
      return Array.from(fontCache.values());
    },

    clearFonts(): void {
      fontCache.clear();
      defaultFontLoaded = false;
      logger?.debug?.('Font cache cleared');
    },
  };
}
