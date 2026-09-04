import { h, type HtmlComponent } from '@zhin.js/satori';
import type { CacheMode, Clip, ScreenshotOptions, CaptureStats } from '@shotkit/shotium';

import { resolveHtmlRendererConfig } from './config.js';
import { createEngine } from './engine.js';
import { buildFontFaces, isFullDocument, withDocumentFile, wrapDocument } from './html.js';
import { readImageSize } from './image.js';
import { serializeJsxToHtml } from './jsx.js';
import { renderHtmlToSvg, svgToPng } from './legacy-svg.js';
import type {
  FontConfig,
  HtmlRendererConfig,
  HtmlRendererLogger,
  HtmlRendererService,
  RenderOptions,
  RenderResult,
} from './types.js';

const MAX_CONCURRENT_RENDERS = 2;

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

function fontKey(font: FontConfig): string {
  return `${font.name}\0${font.weight ?? 400}\0${font.style ?? 'normal'}`;
}

interface ShotiumRenderOptions {
  width?: number;
  height?: number;
  type?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  backgroundColor?: string;
  fonts?: readonly FontConfig[];
  fontFamily?: string;
  scale?: number;
  selector?: string;
  fullPage?: boolean;
  omitBackground?: boolean;
  clip?: Clip;
  timeout?: number;
  waitUntil?: 'load' | 'networkidle';
  headers?: Record<string, string>;
  cache?: CacheMode;
  allowFileAccess?: boolean;
}

interface ShotiumResult {
  data: Buffer;
  width: number;
  height: number;
  mimeType: string;
  stats: CaptureStats;
}

export function createHtmlRenderer(
  config: HtmlRendererConfig = {},
  logger?: HtmlRendererLogger,
): HtmlRendererService {
  const mergedConfig = resolveHtmlRendererConfig(config);
  const engine = createEngine(mergedConfig.shotium, logger);
  const registeredFonts = new Map<string, FontConfig>();
  const warned = new Set<string>();
  let activeRenders = 0;
  const renderQueue: Array<() => void> = [];

  const warnOnce = (key: string, ...message: unknown[]): void => {
    if (warned.has(key)) return;
    warned.add(key);
    logger?.warn?.(...message);
  };

  const getFonts = (extraFonts: readonly FontConfig[] = []): FontConfig[] => {
    const fonts = new Map<string, FontConfig>();
    for (const font of mergedConfig.defaultFonts) fonts.set(fontKey(font), font);
    for (const font of registeredFonts.values()) fonts.set(fontKey(font), font);
    for (const font of extraFonts) fonts.set(fontKey(font), font);
    return [...fonts.values()];
  };

  const acquireRenderSlot = async (): Promise<void> => {
    if (activeRenders >= MAX_CONCURRENT_RENDERS) {
      await new Promise<void>((resolve) => renderQueue.push(resolve));
    }
    activeRenders++;
  };

  const releaseRenderSlot = (): void => {
    activeRenders--;
    renderQueue.shift()?.();
  };

  const renderWithLegacy = async (
    html: string,
    options: RenderOptions = {},
  ): Promise<RenderResult> => {
    const width = options.width ?? mergedConfig.defaultWidth;
    const height = options.height;
    const backgroundColor = options.backgroundColor ?? mergedConfig.defaultBackgroundColor;
    const { svg, width: actualWidth, height: actualHeight } = await renderHtmlToSvg({
      html,
      width,
      height,
      fonts: getFonts(options.fonts ?? []),
      backgroundColor,
      logger,
      enableEmoji: options.enableEmoji,
    });

    if ((options.format ?? 'png') === 'svg') {
      return {
        data: svg,
        format: 'svg',
        width: actualWidth,
        height: actualHeight,
        mimeType: 'image/svg+xml',
      };
    }

    const scale = options.scale ?? 1;
    const png = svgToPng(svg, scale);
    return {
      data: png,
      format: 'png',
      width: Math.round(actualWidth * scale),
      height: Math.round(actualHeight * scale),
      mimeType: 'image/png',
    };
  };

  const capture = async (
    file: string,
    options: ShotiumRenderOptions,
    defaults: { type: 'png' | 'jpeg' | 'webp'; fullPage: boolean; selector?: string },
  ): Promise<ShotiumResult> => {
    const type = options.type ?? defaults.type;
    const shot: ScreenshotOptions = {
      file,
      type,
      viewport: {
        width: Math.round(options.width ?? mergedConfig.shotium.viewport.width),
        height: Math.round(options.height ?? mergedConfig.shotium.viewport.height),
      },
      allowFileAccess: options.allowFileAccess ?? mergedConfig.shotium.allowFileAccess,
      pageGotoParams: {
        waitUntil: options.waitUntil ?? mergedConfig.shotium.waitUntil,
        timeout: options.timeout ?? mergedConfig.shotium.timeout,
      },
    };

    if (type !== 'png') shot.quality = options.quality ?? mergedConfig.shotium.quality;
    const selector = options.selector ?? defaults.selector;
    if (options.fullPage ?? defaults.fullPage) shot.fullPage = true;
    else if (selector) shot.selector = selector;
    if (options.omitBackground && type !== 'jpeg') shot.omitBackground = true;
    if (options.clip && !shot.fullPage && !shot.selector) shot.clip = options.clip;
    const scale = options.scale ?? mergedConfig.shotium.scale;
    if (scale !== 1) shot.scale = scale;
    if (options.headers && Object.keys(options.headers).length > 0) shot.headers = options.headers;
    if (options.cache) shot.cache = options.cache;

    const result = await engine.screenshot(shot);
    const image = result.image;
    if (!image) throw new Error('[shotium] engine returned no image');

    const size = readImageSize(image);
    if (mergedConfig.shotium.logStats) {
      logger?.info?.(
        `[shotium] render ${size ? `${size.width}x${size.height}` : '?'} ${(image.length / 1024).toFixed(1)}KB `
        + `(engine ${result.stats.timing.total.toFixed(1)}ms, requests ${result.stats.requests}, cache ${result.stats.fromCache})`,
      );
    }

    return {
      data: image,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      mimeType: MIME[type],
      stats: result.stats,
    };
  };

  const renderWithShotium = async (
    html: string,
    options: RenderOptions = {},
  ): Promise<RenderResult> => {
    const fonts = getFonts(options.fonts ?? []);
    const wrapped = !isFullDocument(html);
    const document = wrapDocument(html, {
      width: options.width ?? mergedConfig.shotium.viewport.width,
      ...(options.height != null ? { height: options.height } : {}),
      backgroundColor: options.backgroundColor ?? mergedConfig.shotium.backgroundColor,
      fontFamily: mergedConfig.shotium.fontFamily,
      fontFaces: buildFontFaces(fonts),
    });
    const defaults = wrapped
      ? { type: 'png' as const, fullPage: false, selector: 'body' }
      : { type: 'png' as const, fullPage: true };

    const result = await withDocumentFile(document, (file) =>
      capture(file, {
        width: options.width,
        height: options.height,
        backgroundColor: options.backgroundColor,
        scale: options.scale,
      }, defaults));

    return {
      data: result.data,
      format: 'png',
      width: result.width,
      height: result.height,
      mimeType: result.mimeType,
    };
  };

  return {
    async render(html: string, options: RenderOptions = {}): Promise<RenderResult> {
      await acquireRenderSlot();
      try {
        if ((options.format ?? 'png') === 'svg') {
          return await renderWithLegacy(html, { ...options, format: 'svg' });
        }
        try {
          return await renderWithShotium(html, options);
        } catch (error) {
          warnOnce('shotium-fallback', 'html-renderer: shotium failed, falling back to legacy renderer', error);
          return await renderWithLegacy(html, { ...options, format: 'png' });
        }
      } finally {
        releaseRenderSlot();
        engine.release();
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
      return this.render(serializeJsxToHtml(h(component, props)), options);
    },

    registerFont(font: FontConfig): void {
      registeredFonts.set(fontKey(font), font);
      logger?.debug?.(`Font registered: ${font.name}`);
    },

    getFonts(): FontConfig[] {
      return getFonts();
    },

    clearFonts(): void {
      registeredFonts.clear();
      logger?.debug?.('Font cache cleared');
    },
  };
}

export { serializeJsxToHtml } from './jsx.js';
