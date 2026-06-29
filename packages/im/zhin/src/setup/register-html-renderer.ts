import type { Plugin } from '@zhin.js/core';
import { seedHtmlRenderer } from '@zhin.js/core';
import type { AppConfig } from '../types.js';
import { registerHtmlRendererImIntegration } from './html-renderer-im.js';

/**
 * 可选 @zhin.js/html-renderer：RenderImage 组件、Agent 工具、aiTextAsImage。
 * 出站 html/markdown 转图由 core resolveRichSegments 动态 import 处理。
 */
export async function registerHtmlRenderer(
  plugin: Plugin,
  appConfig: AppConfig,
): Promise<void> {
  try {
    const { createHtmlRenderer, registerAiTextAsImageOutput } = await import(
      '@zhin.js/html-renderer'
    );
    const htmlConfig = (appConfig.htmlRenderer ?? {}) as import('@zhin.js/html-renderer').HtmlRendererConfig;
    const renderer = createHtmlRenderer(htmlConfig, plugin.logger);
    seedHtmlRenderer(renderer);

    plugin.onDispose(registerHtmlRendererImIntegration(plugin, renderer));

    const dispose = registerAiTextAsImageOutput({
      root: plugin.root,
      logger: plugin.logger,
      fullConfig: htmlConfig,
      getRenderer: () => renderer,
    });
    if (dispose) {
      plugin.onDispose(dispose);
    }
  } catch {
    plugin.logger.warn(
      '未安装 @zhin.js/html-renderer，已跳过 aiTextAsImage。安装: pnpm add @zhin.js/html-renderer',
    );
    if (process.env.NODE_ENV === 'test') {
      // 测试环境未装包时不抛错
    }
  }
}
