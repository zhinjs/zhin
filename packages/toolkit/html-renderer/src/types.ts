export type OutputFormat = 'svg' | 'png';
export type RasterFormat = 'png' | 'jpeg' | 'webp';
export type WaitUntil = 'load' | 'networkidle';
export type HtmlComponent<P> = (props: P) => unknown;

export interface FontConfig {
  name: string;
  data: ArrayBuffer | Buffer;
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  style?: 'normal' | 'italic';
}

export interface RenderOptions {
  width?: number;
  height?: number;
  format?: OutputFormat;
  backgroundColor?: string;
  fonts?: FontConfig[];
  enableEmoji?: boolean;
  scale?: number;
}

export interface RenderResult {
  data: Buffer | string;
  format: OutputFormat;
  width: number;
  height: number;
  mimeType: string;
}

export interface HtmlRendererAiTextAsImageConfig {
  enabled?: boolean;
  onlyAdapters?: string[];
  minLength?: number;
  maxLength?: number;
  skipIfRich?: boolean;
  width?: number;
  height?: number;
  backgroundColor?: string;
  fontSize?: number;
  color?: string;
  padding?: number;
  scale?: number;
  fileName?: string;
}

export interface HtmlRendererViewport {
  width?: number;
  height?: number;
}

export interface HtmlRendererConfig {
  defaultWidth?: number;
  width?: number;
  defaultFonts?: FontConfig[];
  defaultBackgroundColor?: string;
  backgroundColor?: string;
  aiTextAsImage?: boolean | HtmlRendererAiTextAsImageConfig;
  viewport?: HtmlRendererViewport;
  scale?: number;
  type?: RasterFormat;
  quality?: number;
  timeout?: number;
  waitUntil?: WaitUntil;
  fontFamily?: string;
  maxImageHeight?: number;
  sliceCompression?: number;
  allowFileAccess?: boolean;
  takeOverHtmlSegments?: boolean;
  cacheDir?: string;
  cacheMaxBytes?: number;
  userAgent?: string;
  idleTimeoutMs?: number;
  logStats?: boolean;
  htmlRenderer?: HtmlRendererConfig | Record<string, unknown>;
}

export interface HtmlRendererService {
  render(html: string, options?: RenderOptions): Promise<RenderResult>;
  renderJsx(element: unknown, options?: RenderOptions): Promise<RenderResult>;
  renderComponent<P>(
    component: HtmlComponent<P>,
    props: P,
    options?: RenderOptions,
  ): Promise<RenderResult>;
  registerFont(font: FontConfig): void;
  getFonts(): FontConfig[];
  clearFonts(): void;
}

export interface HtmlRendererLogger {
  debug?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
}
