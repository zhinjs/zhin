import { htmlToSvg, getAllBuiltinFonts, h, e, type HtmlComponent } from '@zhin.js/satori';

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
};

/** 外部资源（twemoji CDN）拉取超时 */
const EMOJI_FETCH_TIMEOUT_MS = 10_000;

/** 渲染并发上限，防止渲染任务堆积拖垮进程 */
const MAX_CONCURRENT_RENDERS = 2;

const fontCache: Map<string, FontConfig> = new Map();
let defaultFontLoaded = false;

/** fontCache 键：name + weight + style（缺 style 会让 italic 覆盖 normal） */
function fontCacheKey(
  name: string,
  weight?: FontConfig['weight'],
  style?: FontConfig['style'],
): string {
  return `${name}-${weight ?? 400}-${style ?? 'normal'}`;
}

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
        fontCache.set(fontCacheKey(font.name, font.weight, font.style), fc);
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
    const response = await fetch(url, { signal: AbortSignal.timeout(EMOJI_FETCH_TIMEOUT_MS) });
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

const EMOJI_CACHE_MAX = 200;
/** 失败（null）结果的负缓存 TTL，避免每次渲染都重试失败的 emoji */
const EMOJI_NEGATIVE_TTL_MS = 60_000;

interface EmojiCacheEntry {
  value: string | null;
  ts: number;
}

/** LRU：Map 迭代顺序即插入顺序，命中时移到末尾，超容量时淘汰最旧项 */
const emojiCache: Map<string, EmojiCacheEntry> = new Map();

function getCachedEmoji(segment: string): { hit: boolean; value: string | null } {
  const entry = emojiCache.get(segment);
  if (!entry) return { hit: false, value: null };
  if (entry.value === null && Date.now() - entry.ts > EMOJI_NEGATIVE_TTL_MS) {
    emojiCache.delete(segment);
    return { hit: false, value: null };
  }
  // LRU touch：重新插入到末尾
  emojiCache.delete(segment);
  emojiCache.set(segment, entry);
  return { hit: true, value: entry.value };
}

function setCachedEmoji(segment: string, value: string | null): void {
  emojiCache.delete(segment);
  emojiCache.set(segment, { value, ts: Date.now() });
  while (emojiCache.size > EMOJI_CACHE_MAX) {
    const oldest = emojiCache.keys().next().value;
    if (oldest === undefined) break;
    emojiCache.delete(oldest);
  }
}

async function loadAdditionalAsset(
  languageCode: string,
  segment: string,
  logger?: HtmlRendererLogger,
): Promise<string | null> {
  if (languageCode === 'emoji') {
    const cached = getCachedEmoji(segment);
    if (cached.hit) return cached.value;
    const result = await loadEmojiImage(segment, logger);
    // 失败也缓存（短 TTL 负缓存），防止同一 emoji 反复打爆 CDN
    setCachedEmoji(segment, result);
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
  enableEmoji: boolean = true,
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
      enableEmoji ? ((await loadAdditionalAsset(code, seg, logger)) ?? '') : '',
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

export function serializeJsxToHtml(element: unknown): string {
  if (typeof element === 'string') return e(element);
  if (typeof element === 'number') return String(element);
  // boolean / null / undefined 一律渲染为空串
  if (element == null || typeof element === 'boolean') return '';
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
      .filter(([key, value]) => key !== 'dangerouslySetInnerHTML' && value != null && value !== false)
      .map(([key, value]) => `${key}="${e(String(value))}"`)
      .join(' ');

    const styleAttr = styleStr ? ` style="${e(styleStr)}"` : '';
    const attrStr = attrs ? ` ${attrs}` : '';

    // Raw HTML 只走显式通道 dangerouslySetInnerHTML
    if (dangerouslySetInnerHTML?.__html) {
      return `<${type}${attrStr}${styleAttr}>${dangerouslySetInnerHTML.__html}</${type}>`;
    }

    const childrenHtml = serializeJsxToHtml(children);
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

  function cacheDefaultFonts(): void {
    for (const font of mergedConfig.defaultFonts) {
      fontCache.set(fontCacheKey(font.name, font.weight, font.style), font);
    }
  }

  ensureBuiltinFontsCached(logger);
  cacheDefaultFonts();

  // 渲染并发闸：最多 MAX_CONCURRENT_RENDERS 个并发，其余排队
  let activeRenders = 0;
  const renderQueue: Array<() => void> = [];

  async function acquireRenderSlot(): Promise<void> {
    if (activeRenders >= MAX_CONCURRENT_RENDERS) {
      await new Promise<void>((resolve) => renderQueue.push(resolve));
    }
    activeRenders++;
  }

  function releaseRenderSlot(): void {
    activeRenders--;
    const next = renderQueue.shift();
    if (next) next();
  }

  return {
    async render(html: string, options: RenderOptions = {}): Promise<RenderResult> {
      const {
        width = mergedConfig.defaultWidth,
        height,
        format = 'png',
        backgroundColor = mergedConfig.defaultBackgroundColor,
        fonts = [],
        enableEmoji = true,
        scale = 1,
      } = options;

      await acquireRenderSlot();
      try {
        ensureBuiltinFontsCached(logger);
        const allFonts = uniqueFontsForRender([...fontCache.values(), ...fonts]);

        const { svg, width: actualWidth, height: actualHeight } = await renderHtmlToSvg(
          html,
          width,
          height,
          allFonts,
          backgroundColor,
          logger,
          enableEmoji,
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
      } finally {
        releaseRenderSlot();
      }
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
      fontCache.set(fontCacheKey(font.name, font.weight, font.style), font);
      logger?.debug?.(`Font registered: ${font.name}`);
    },

    getFonts(): FontConfig[] {
      return Array.from(fontCache.values());
    },

    clearFonts(): void {
      fontCache.clear();
      defaultFontLoaded = false;
      // clear 后重新合并 defaultFonts，避免用户配置的默认字体永久丢失
      cacheDefaultFonts();
      logger?.debug?.('Font cache cleared');
    },
  };
}
