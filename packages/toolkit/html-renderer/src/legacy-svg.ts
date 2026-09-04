import { htmlToSvg, getAllBuiltinFonts } from '@zhin.js/satori';
import { Resvg } from '@resvg/resvg-js';

import type { FontConfig, HtmlRendererLogger } from './types.js';

const EMOJI_FETCH_TIMEOUT_MS = 10_000;
const EMOJI_CACHE_MAX = 200;
const EMOJI_NEGATIVE_TTL_MS = 60_000;

interface EmojiCacheEntry {
  value: string | null;
  ts: number;
}

const builtinFontCache = new Map<string, FontConfig>();
let builtinFontsLoaded = false;
const emojiCache = new Map<string, EmojiCacheEntry>();

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

function ensureBuiltinFonts(logger?: HtmlRendererLogger): FontConfig[] {
  if (!builtinFontsLoaded) {
    try {
      for (const font of getAllBuiltinFonts()) {
        builtinFontCache.set(fontCacheKey(font.name, font.weight, font.style), toFontConfig(font));
      }
    } catch (error) {
      logger?.warn?.('html-renderer: builtin fonts failed', error);
    }
    builtinFontsLoaded = true;
  }
  return [...builtinFontCache.values()];
}

function uniqueFontsForRender(list: FontConfig[]): FontConfig[] {
  const fonts = new Map<string, FontConfig>();
  for (const font of list) {
    fonts.set(`${font.name}\0${font.weight ?? 400}\0${font.style ?? 'normal'}`, font);
  }
  return [...fonts.values()];
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

function getCachedEmoji(segment: string): { hit: boolean; value: string | null } {
  const entry = emojiCache.get(segment);
  if (!entry) return { hit: false, value: null };
  if (entry.value === null && Date.now() - entry.ts > EMOJI_NEGATIVE_TTL_MS) {
    emojiCache.delete(segment);
    return { hit: false, value: null };
  }
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

function wrapHtmlFragment(html: string, backgroundColor: string): string {
  if (html.includes('<!DOCTYPE') || html.includes('<html')) return html;
  return `<div style="display:flex;flex-direction:column;width:100%;height:100%;margin:0;padding:0;box-sizing:border-box;background-color:${backgroundColor};font-family:Noto Sans SC,sans-serif">${html}</div>`;
}

export async function renderHtmlToSvg(params: {
  html: string;
  width: number;
  height?: number;
  fonts: FontConfig[];
  backgroundColor?: string;
  logger?: HtmlRendererLogger;
  enableEmoji?: boolean;
}): Promise<{ svg: string; width: number; height: number }> {
  const {
    html,
    width,
    height,
    fonts,
    backgroundColor,
    logger,
    enableEmoji = true,
  } = params;
  const finalFonts = uniqueFontsForRender([...ensureBuiltinFonts(logger), ...fonts]);
  if (finalFonts.length === 0) {
    logger?.warn?.('html-renderer: no fonts; non-ascii text may fail');
  }

  const svg = await htmlToSvg(wrapHtmlFragment(html, backgroundColor ?? '#ffffff'), {
    width,
    ...(height != null && { height }),
    fonts: finalFonts.map((font) => ({
      name: font.name,
      data: font.data,
      weight: font.weight,
      style: font.style,
    })),
    loadAdditionalAsset: async (code: string, segment: string) => {
      if (!enableEmoji || code !== 'emoji') return '';
      const cached = getCachedEmoji(segment);
      if (cached.hit) return cached.value ?? '';
      const result = await loadEmojiImage(segment, logger);
      setCachedEmoji(segment, result);
      return result ?? '';
    },
  });

  const wm = svg.match(/width="(\d+)"/);
  const hm = svg.match(/height="(\d+)"/);
  return {
    svg,
    width: wm ? parseInt(wm[1], 10) : width,
    height: hm ? parseInt(hm[1], 10) : height || width,
  };
}

export function svgToPng(svg: string, scale = 1): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: scale !== 1 ? { mode: 'zoom', value: scale } : undefined,
  });
  return Buffer.from(resvg.render().asPng());
}
