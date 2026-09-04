import { createToken } from './token.js';

export interface HtmlRenderOptions {
  readonly width?: number;
  /** 兼容旧调用方；当前实现传 `svg` 也会降级为 png。 */
  readonly format?: 'png' | 'svg';
  readonly backgroundColor?: string;
}

export interface HtmlRenderResult {
  /** 当前实现恒为 png：Buffer/Uint8Array。 */
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
