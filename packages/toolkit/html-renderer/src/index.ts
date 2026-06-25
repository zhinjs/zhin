export { createHtmlRenderer } from './renderer.js';
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
} from './types.js';

/** 动态 import 时使用的包名（与 package.json name 一致） */
export const HTML_RENDERER_PACKAGE = '@zhin.js/html-renderer';
