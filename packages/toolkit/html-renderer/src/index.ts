export { createHtmlRenderer } from './renderer.js';
export { serializeJsxToHtml } from './jsx.js';
export { registerAiTextAsImageOutput, extractPlainTextForImage } from './ai-text-as-image.js';
export type {
  FontConfig,
  HtmlRendererAiTextAsImageConfig,
  HtmlRendererConfig,
  HtmlRendererLogger,
  HtmlRendererService,
  OutputFormat,
  RenderOptions,
  RenderResult,
  RasterFormat,
  WaitUntil,
} from './types.js';

export const HTML_RENDERER_PACKAGE = '@zhin.js/html-renderer';
