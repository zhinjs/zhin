import { createToken } from './token.js';

export interface HtmlRenderOptions {
  readonly width?: number;
  readonly format?: 'png' | 'svg';
  readonly backgroundColor?: string;
}

export interface HtmlRenderResult {
  /** PNG 时为 Buffer/Uint8Array，SVG 时为 string。 */
  readonly data: unknown;
  readonly format: 'png' | 'svg';
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
