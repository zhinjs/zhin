import type {
  FontConfig,
  HtmlRendererAiTextAsImageConfig,
  HtmlRendererConfig,
  RasterFormat,
  WaitUntil,
} from './types.js';

export interface ShotiumConfig {
  viewport: { width: number; height: number };
  scale: number;
  type: RasterFormat;
  quality: number;
  timeout: number;
  waitUntil: WaitUntil;
  backgroundColor: string;
  fontFamily: string;
  maxImageHeight: number;
  sliceCompression: number;
  allowFileAccess: boolean;
  takeOverHtmlSegments: boolean;
  cacheDir: string;
  cacheMaxBytes: number;
  userAgent: string;
  idleTimeoutMs: number;
  logStats: boolean;
  mode: 'inprocess' | 'daemon';
}

export interface ResolvedHtmlRendererConfig {
  defaultWidth: number;
  defaultFonts: FontConfig[];
  defaultBackgroundColor: string;
  aiTextAsImage?: boolean | HtmlRendererAiTextAsImageConfig;
  shotium: ShotiumConfig;
}

const DEFAULT_CONFIG: ResolvedHtmlRendererConfig = {
  defaultWidth: 800,
  defaultFonts: [],
  defaultBackgroundColor: '#ffffff',
  aiTextAsImage: undefined,
  shotium: {
    mode: 'inprocess',
    viewport: { width: 800, height: 600 },
    scale: 1,
    type: 'png',
    quality: 90,
    timeout: 30_000,
    waitUntil: 'load',
    backgroundColor: '#ffffff',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
    maxImageHeight: 0,
    sliceCompression: 3,
    allowFileAccess: true,
    takeOverHtmlSegments: true,
    cacheDir: '',
    cacheMaxBytes: 256 * 1024 * 1024,
    userAgent: '',
    idleTimeoutMs: 300_000,
    logStats: false,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? clamp(value, min, max)
    : fallback;
}

function pickString<T extends string>(
  value: unknown,
  fallback: T,
  allowed?: readonly T[],
): T {
  if (typeof value !== 'string') return fallback;
  if (allowed && !allowed.includes(value as T)) return fallback;
  return value as T;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickConfigRoot(raw: unknown): HtmlRendererConfig & Record<string, unknown> {
  if (raw && typeof raw === 'object') {
    const input = raw as HtmlRendererConfig & Record<string, unknown>;
    if (input.htmlRenderer && typeof input.htmlRenderer === 'object') {
      return input.htmlRenderer as HtmlRendererConfig & Record<string, unknown>;
    }
    return input;
  }
  return {};
}

export function resolveHtmlRendererConfig(raw: unknown): ResolvedHtmlRendererConfig {
  const input = pickConfigRoot(raw);
  const viewport = (input.viewport ?? {}) as Record<string, unknown>;
  const defaultWidth = pickNumber(
    input.defaultWidth ?? input.width ?? viewport.width,
    DEFAULT_CONFIG.defaultWidth,
    1,
    30_000,
  );
  const defaultBackgroundColor = pickString(
    input.defaultBackgroundColor ?? input.backgroundColor,
    DEFAULT_CONFIG.defaultBackgroundColor,
  );

  return {
    defaultWidth,
    defaultFonts: Array.isArray(input.defaultFonts) ? input.defaultFonts.filter(Boolean) : [],
    defaultBackgroundColor,
    aiTextAsImage: input.aiTextAsImage,
    shotium: {
      mode: pickString(input.mode, DEFAULT_CONFIG.shotium.mode, ['inprocess', 'daemon']),
      viewport: {
        width: pickNumber(viewport.width ?? input.width ?? input.defaultWidth, defaultWidth, 1, 30_000),
        height: pickNumber(viewport.height, DEFAULT_CONFIG.shotium.viewport.height, 1, 30_000),
      },
      scale: pickNumber(input.scale, DEFAULT_CONFIG.shotium.scale, 0.01, 8),
      type: pickString(input.type, DEFAULT_CONFIG.shotium.type, ['png', 'jpeg', 'webp']),
      quality: pickNumber(input.quality, DEFAULT_CONFIG.shotium.quality, 1, 100),
      timeout: pickNumber(input.timeout, DEFAULT_CONFIG.shotium.timeout, 1, 600_000),
      waitUntil: pickString(input.waitUntil, DEFAULT_CONFIG.shotium.waitUntil, ['load', 'networkidle']),
      backgroundColor: pickString(
        input.backgroundColor ?? input.defaultBackgroundColor,
        defaultBackgroundColor,
      ),
      fontFamily: pickString(input.fontFamily, DEFAULT_CONFIG.shotium.fontFamily),
      maxImageHeight: pickNumber(
        input.maxImageHeight,
        DEFAULT_CONFIG.shotium.maxImageHeight,
        0,
        100_000,
      ),
      sliceCompression: pickNumber(
        input.sliceCompression,
        DEFAULT_CONFIG.shotium.sliceCompression,
        0,
        9,
      ),
      allowFileAccess: pickBoolean(
        input.allowFileAccess,
        DEFAULT_CONFIG.shotium.allowFileAccess,
      ),
      takeOverHtmlSegments: pickBoolean(
        input.takeOverHtmlSegments,
        DEFAULT_CONFIG.shotium.takeOverHtmlSegments,
      ),
      cacheDir: pickString(input.cacheDir, DEFAULT_CONFIG.shotium.cacheDir),
      cacheMaxBytes: pickNumber(
        input.cacheMaxBytes,
        DEFAULT_CONFIG.shotium.cacheMaxBytes,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      userAgent: pickString(input.userAgent, DEFAULT_CONFIG.shotium.userAgent),
      idleTimeoutMs: pickNumber(
        input.idleTimeoutMs,
        DEFAULT_CONFIG.shotium.idleTimeoutMs,
        0,
        86_400_000,
      ),
      logStats: pickBoolean(input.logStats, DEFAULT_CONFIG.shotium.logStats),
    },
  };
}
