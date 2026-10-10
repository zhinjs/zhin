import { createToken } from './token.js';

export interface HtmlRenderOptions {
  readonly width?: number;
  /** Static raster output; defaults to PNG. */
  readonly format?: 'png' | 'jpeg' | 'webp';
  readonly backgroundColor?: string;
}

export interface HtmlRenderResult {
  /** Raster bytes from the optional rendering engine. */
  readonly data: unknown;
  readonly format: 'png' | 'jpeg' | 'webp';
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
}

/**
 * Thin Host Resource for Plugin Runtime outbound html→image rendering.
 * Implemented by the optional `@zhin.js/html-renderer` package (wired by the
 * CLI Host); absent when the package is not installed — consumers must fall
 * back to plain text.
 */
export interface HtmlRendererHost {
  render(html: string, options?: HtmlRenderOptions): Promise<HtmlRenderResult>;
}

export const htmlRendererToken = createToken<HtmlRendererHost>(
  'zhin.html-renderer.host',
  'Plugin Runtime html → image renderer host',
);
